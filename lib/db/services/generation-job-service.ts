/**
 * GenerationJobService
 * Job lifecycle operations for the GenerationJob model.
 *
 * Status transitions:
 *   queueJob    → QUEUED      (progress = 0)
 *   processJob  → PROCESSING → VALIDATING → COMPLETED | FAILED (run by the
 *                 BullMQ worker: batch generation + in-memory audit, upload to
 *                 S3/R2, presigned exportUrl)
 *   validateJob → records the audit report as a ValidationResult
 *   completeJob → COMPLETED   (progress = 100, completedAt = now, exportUrl,
 *                 healthCheckPassed)
 *   failJob     → FAILED      (validationErrors = errors array)
 */

import prisma from "@/lib/db/prisma";
import type {
  GenerationJob,
  GenerationJobWithRelations,
  GenerationJobFilters,
  ValidationResult,
  ValidationError,
  CreateGenerationJobInput,
  UpdateGenerationJobInput,
  TableStructure,
  PaginationParams,
  PaginatedResponse,
} from "@/types/database";
import { ExportFormat, JobStatus } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { TabularEngineError, randomSeed } from "@/lib/engine/tabular-engine";
import { resolveFakerLocale } from "@/lib/engine/locale";
import {
  createRelationalTableGenerator,
  planRelationalSchema,
  tableSeed,
  tableStructuresToRelationalInput,
  type KeyPools,
  type PlannedTable,
} from "@/lib/engine/relational-engine";
import {
  ArchiveError,
  ExportError,
  createJsonExportWriter,
  createSqlDumpWriter,
  createTableExportWriter,
  deleteJobExports,
  publishJobExport,
  removeJobStaging,
  sanitizeFileName,
  type ExportFileFormat,
  type SqlDumpWriter,
  type SqlTable,
  type TableExportWriter,
} from "@/lib/engine/exporter";
import {
  StorageError,
  deletePrefix,
  jobExportPrefix,
  jobIdFromKey,
  listObjects,
  refreshPresignedUrl,
} from "@/lib/storage/s3";
import { removeQueuedJob } from "@/lib/queue/client";
import { createDatasetAuditor, type AuditReport } from "@/lib/engine/auditor";

// ============================================
// CRUD Operations
// ============================================

/**
 * Create a new generation job.
 * The initial status defaults to QUEUED and progress to 0 (schema defaults).
 */
export async function createJob(
  data: CreateGenerationJobInput
): Promise<GenerationJob> {
  try {
    return await prisma.generationJob.create({ data });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new Error(`Failed to create generation job: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Retrieve a single generation job by ID.
 * Returns null when not found.
 */
export async function getJob(id: string): Promise<GenerationJob | null> {
  try {
    return await prisma.generationJob.findUnique({ where: { id } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new Error(`Failed to fetch generation job: ${error.message}`);
    }
    throw error;
  }
}

export type GenerationJobListItem = GenerationJob & {
  validationResults: Pick<ValidationResult, "id" | "isPassed" | "summary">[];
};

/**
 * List generation jobs with optional filtering and pagination. Each job carries
 * its latest ValidationResult summary (issues are fetched per job on demand).
 */
export async function listJobs(
  filters?: GenerationJobFilters,
  pagination?: PaginationParams
): Promise<PaginatedResponse<GenerationJobListItem>> {
  const page = pagination?.page ?? 1;
  const limit = pagination?.limit ?? 10;
  const skip = (page - 1) * limit;

  const where: Prisma.GenerationJobWhereInput = {
    ...(filters?.workspaceId && { workspaceId: filters.workspaceId }),
    ...(filters?.schemaId && { schemaId: filters.schemaId }),
    ...(filters?.status?.length && { status: { in: filters.status } }),
    ...(filters?.dateFrom && { createdAt: { gte: filters.dateFrom } }),
    ...(filters?.dateTo && { createdAt: { lte: filters.dateTo } }),
  };

  const orderBy: Prisma.GenerationJobOrderByWithRelationInput = {
    [pagination?.sortBy ?? "createdAt"]: pagination?.sortOrder ?? "desc",
  };

  try {
    const [data, total] = await Promise.all([
      prisma.generationJob.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        include: {
          validationResults: {
            select: { id: true, isPassed: true, summary: true },
            orderBy: { createdAt: "desc" },
            take: 1,
          },
        },
      }),
      prisma.generationJob.count({ where }),
    ]);

    return {
      data,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new Error(`Failed to list generation jobs: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Generic status + optional progress update.
 * Used internally by the lifecycle methods and exposed for direct callers.
 */
export async function updateJobStatus(
  id: string,
  status: JobStatus,
  progress?: number
): Promise<GenerationJob> {
  try {
    return await prisma.generationJob.update({
      where: { id },
      data: {
        status,
        ...(progress !== undefined && { progress }),
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2025") {
        throw new Error(`Generation job with id "${id}" not found.`);
      }
      throw new Error(`Failed to update job status: ${error.message}`);
    }
    throw error;
  }
}

// ============================================
// Job Lifecycle Operations
// ============================================

/**
 * Place a job in the queue.
 * Sets status → QUEUED and resets progress to 0.
 */
export async function queueJob(id: string): Promise<GenerationJob> {
  return updateJobStatus(id, JobStatus.QUEUED, 0);
}

// ============================================
// Job Execution
// ============================================

export const JOB_BATCH_SIZE = 1_000;
export const JOB_DEFAULT_ROW_COUNT = 1_000;
export const JOB_MAX_ROW_COUNT = 1_000_000;

/** Yields to the event loop so the worker can renew its queue lock between batches. */
const yieldToEventLoop = () => new Promise<void>((resolve) => setImmediate(resolve));

/** Atomic $set of the progress field only. */
async function setJobProgress(id: string, progress: number): Promise<void> {
  await prisma.generationJob.update({ where: { id }, data: { progress } });
}

function parseTables(raw: Prisma.JsonValue): TableStructure[] {
  if (!Array.isArray(raw)) return [];
  return (raw as unknown as Partial<TableStructure>[]).filter(
    (t): t is TableStructure => Array.isArray(t?.columns) && t.columns.length > 0
  );
}

function toSqlTable(table: PlannedTable): SqlTable {
  return {
    name: table.name,
    columns: table.columns.map((c) => ({
      key: c.key,
      name: c.name,
      type: c.type,
      nullable: !c.isPrimaryKey && c.nullRate > 0,
      isPrimaryKey: c.isPrimaryKey,
      isUnique: c.isUnique,
    })),
    foreignKeys: table.foreignKeys.map((fk) => ({
      fromColumn: fk.fromColumn,
      toTable: fk.toTable,
      toColumn: fk.toColumn,
      onDelete: fk.onDelete,
      onUpdate: fk.onUpdate,
    })),
  };
}

/** One CSV per table named after it (customers.csv, orders.csv, …), de-duplicated. */
function csvFileBases(tables: PlannedTable[]): string[] {
  const used = new Set<string>();
  return tables.map((table) => {
    const base = sanitizeFileName(table.name, `table${table.index + 1}`);
    let name = base;
    for (let i = 2; used.has(name.toLowerCase()); i++) name = `${base}_${i}`;
    used.add(name.toLowerCase());
    return name;
  });
}

/** Rows per table printed in the PDF report (the full data stays in CSV/JSON/SQL). */
export const PDF_REPORT_MAX_ROWS = 500;

export interface PdfReportTable {
  name: string;
  columns: string[];
  rows: (string | number | boolean | null | undefined)[][];
  totalRows: number;
}

/**
 * Renders the PDF report for jobs that request ExportFormat.PDF. Injected by
 * the worker so @react-pdf/renderer never ends up in the Next.js route bundles.
 */
export type PdfReportRenderer = (input: {
  title: string;
  subtitle?: string;
  tables: PdfReportTable[];
}) => Promise<Buffer>;

export interface ProcessJobOptions {
  renderPdfReport?: PdfReportRenderer;
}

export function exportFormatToFile(format: ExportFormat | null | undefined): ExportFileFormat | undefined {
  return format ? (format.toLowerCase() as ExportFileFormat) : undefined;
}

/**
 * Execute a queued job (called by the BullMQ worker): generate rows in batches,
 * stream them to local staging files (CSV, JSON, SQL) while auditing them in
 * memory, upload the artifacts to S3/R2 and record progress, the health check
 * report and a 24-hour presigned exportUrl. Audit errors don't fail the job:
 * they set healthCheckPassed = false so the data stays downloadable.
 *
 * Only jobs whose workspace belongs to `userId` are processed. The job is claimed
 * atomically; a PROCESSING/VALIDATING job may be re-claimed because BullMQ only redelivers
 * a job after the previous worker's lock has expired (i.e. it crashed).
 * Any failure marks the job FAILED with the error in validationErrors.
 */
export async function processJob(
  id: string,
  userId: string,
  options: ProcessJobOptions = {}
): Promise<GenerationJob> {
  const job = await prisma.generationJob.findUnique({
    where: { id },
    include: { workspace: { select: { userId: true } }, schema: true },
  });
  if (!job) {
    throw new Error(`Generation job with id "${id}" not found.`);
  }
  if (job.workspace.userId !== userId) {
    throw new Error(`Generation job "${id}" does not belong to the current user.`);
  }

  const claimed = await prisma.generationJob.updateMany({
    where: {
      id,
      status: { in: [JobStatus.QUEUED, JobStatus.PROCESSING, JobStatus.VALIDATING] },
    },
    data: { status: JobStatus.PROCESSING, progress: 0, healthCheckPassed: null },
  });
  if (claimed.count === 0) {
    return (await getJob(id)) as GenerationJob;
  }

  const writers: TableExportWriter[] = [];
  const jsonWriters: TableExportWriter[] = [];
  let sqlWriter: SqlDumpWriter | undefined;
  try {
    const { schema } = job;
    if (schema.workspaceId !== job.workspaceId) {
      throw new Error("Schema does not belong to the job's workspace.");
    }

    const tables = parseTables(schema.tables);
    if (tables.length === 0) {
      throw new Error(`Schema "${schema.name}" has no tables with columns to generate.`);
    }

    // Parents come before children, so every FK value already exists when it's sampled
    // and the SQL dump inserts in an order that never violates a constraint
    const plan = planRelationalSchema(tableStructuresToRelationalInput(tables));
    const fileBases = csvFileBases(plan.tables);
    sqlWriter = await createSqlDumpWriter(id, plan.tables.map(toSqlTable));
    // Audits each batch as it is written, so only key-column values stay in memory
    const auditor = createDatasetAuditor(plan.tables);

    const rowCount = Math.min(
      Math.max(Math.floor(job.rowCount ?? JOB_DEFAULT_ROW_COUNT), 1),
      JOB_MAX_ROW_COUNT
    );
    const baseSeed = job.seed ?? randomSeed();
    const locale = resolveFakerLocale(job.locale);
    const pools: KeyPools = new Map();
    let lastProgress = 0;
    // PDF jobs keep a leading sample of every table for the report
    const wantsPdf = job.exportFormat === ExportFormat.PDF;
    if (wantsPdf && !options.renderPdfReport) {
      throw new ExportError("PDF export is only available when the job runs in the worker.");
    }
    const reportTables: PdfReportTable[] = [];

    for (const [position, table] of plan.tables.entries()) {
      const writer = await createTableExportWriter(id, fileBases[position], table.columns);
      writers.push(writer);
      const jsonWriter = await createJsonExportWriter(id, fileBases[position], table.columns);
      jsonWriters.push(jsonWriter);

      // Tables with a cardinality get min–max rows per parent row; the rest get
      // rowCount. The seed is offset per table so identical tables differ.
      const generator = createRelationalTableGenerator(
        table,
        pools,
        tableSeed(baseSeed, table),
        { rowCount, maxRows: JOB_MAX_ROW_COUNT, locale }
      );
      const tableRows = generator.rowCount;
      const reportTable: PdfReportTable | null = wantsPdf
        ? { name: table.name, columns: table.columns.map((c) => c.name), rows: [], totalRows: tableRows }
        : null;
      if (reportTable) reportTables.push(reportTable);

      for (let offset = 0; offset < tableRows; offset += JOB_BATCH_SIZE) {
        const size = Math.min(JOB_BATCH_SIZE, tableRows - offset);
        const rows = generator.next(size);
        await writer.writeBatch(rows);
        await jsonWriter.writeBatch(rows);
        await sqlWriter.writeBatch(table.name, rows);
        auditor.observe(table.name, rows);
        if (reportTable && reportTable.rows.length < PDF_REPORT_MAX_ROWS) {
          for (const row of rows.slice(0, PDF_REPORT_MAX_ROWS - reportTable.rows.length)) {
            reportTable.rows.push(table.columns.map((c) => row[c.key]));
          }
        }

        // Child row counts aren't known until their parents exist, so each
        // table is an equal share of the bar. Keep 100 reserved for completion.
        const done = (position + (offset + size) / tableRows) / plan.tables.length;
        const progress = Math.min(99, Math.floor(done * 100));
        if (progress !== lastProgress) {
          await setJobProgress(id, progress);
          lastProgress = progress;
        }
        await yieldToEventLoop();
      }

      await writer.close();
      await jsonWriter.close();
    }
    await sqlWriter.close();

    // Health checks run before anything is published or the job is completed
    await updateJobStatus(id, JobStatus.VALIDATING, 99);
    const report = auditor.finalize();

    const primaryFormat = exportFormatToFile(job.exportFormat);
    const pdf =
      wantsPdf && options.renderPdfReport
        ? await options.renderPdfReport({
            title: `${schema.name} v${schema.version}`,
            subtitle: `Generated ${new Date().toUTCString()} · seed ${baseSeed} · ${plan.tables.length} table${plan.tables.length === 1 ? "" : "s"}`,
            tables: reportTables,
          })
        : undefined;

    // exportUrl points at the CSV (single table) or dataset.zip (CSV + JSON + SQL);
    // every file sits under the job's prefix and is served by /api/jobs/[id]/download
    const { primary, files } = await publishJobExport(
      job.workspaceId,
      id,
      `${schema.name}_v${schema.version}`,
      writers,
      sqlWriter,
      jsonWriters,
      { primaryFormat, pdf }
    );
    await validateJob(id, report);
    return await completeJob(
      id,
      primary.url,
      primary.sizeBytes,
      report.passed,
      files.map((f) => f.format)
    );
  } catch (error) {
    await Promise.allSettled([
      ...writers.map((w) => w.abort()),
      ...jsonWriters.map((w) => w.abort()),
      sqlWriter?.abort(),
    ]);
    // Covers partial uploads and jobs deleted mid-run (completeJob → not found)
    await deleteJobExports(job.workspaceId, id).catch((cleanupError) => {
      console.error(`[jobs] Failed to clean up exports for job ${id}:`, cleanupError);
    });

    const message = error instanceof Error ? error.message : String(error);
    return failJob(id, [
      {
        message,
        severity: "error",
        code:
          error instanceof TabularEngineError
            ? "GENERATION_ERROR"
            : error instanceof ArchiveError
              ? "ARCHIVE_ERROR"
              : error instanceof ExportError || error instanceof StorageError
              ? "EXPORT_ERROR"
              : "JOB_FAILED",
        ...(error instanceof TabularEngineError && error.column && { field: error.column }),
      },
    ]);
  } finally {
    await removeJobStaging(id).catch(() => undefined);
  }
}

/**
 * Delete a job, drop it from the queue if it hasn't started, and remove its
 * files from the storage bucket.
 */
export async function deleteJob(id: string): Promise<GenerationJob> {
  let job: GenerationJob;
  try {
    job = await prisma.generationJob.delete({ where: { id } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2025") {
        throw new Error(`Generation job with id "${id}" not found.`);
      }
      throw new Error(`Failed to delete generation job: ${error.message}`);
    }
    throw error;
  }

  // An active job can't be removed from the queue; the worker cleans up its own
  // upload once it finds the record gone.
  await removeQueuedJob(id).catch((error) => {
    console.error(`[jobs] Failed to remove job ${id} from the queue:`, error);
  });
  // Anything missed here is caught by sweepOrphanedExports
  await deleteJobExports(job.workspaceId, id).catch((error) => {
    console.error(`[jobs] Failed to delete exports for job ${id}:`, error);
  });

  return job;
}

// ============================================
// Export URLs & Storage Cleanup
// ============================================

/**
 * Re-signs a job's presigned exportUrl when it has expired (or is about to) and
 * persists the new URL, so the UI always receives a working download link.
 */
export async function withFreshExportUrl<T extends GenerationJob>(job: T): Promise<T> {
  if (!job.exportUrl) return job;

  try {
    const fresh = await refreshPresignedUrl(
      job.exportUrl,
      jobExportPrefix(job.workspaceId, job.id)
    );
    if (!fresh) return job;

    await prisma.generationJob.updateMany({
      where: { id: job.id, exportUrl: job.exportUrl },
      data: { exportUrl: fresh },
    });
    return { ...job, exportUrl: fresh };
  } catch (error) {
    console.error(`[jobs] Failed to refresh exportUrl for job ${job.id}:`, error);
    return job;
  }
}

/**
 * Deletes bucket objects whose job no longer exists (e.g. a storage delete
 * failed, or a job was removed while its upload was in flight). Objects newer
 * than `minAgeMs` are skipped to stay clear of uploads that are still running.
 */
export async function sweepOrphanedExports(minAgeMs = 60 * 60 * 1000): Promise<number> {
  const prefixesByJob = new Map<string, string>();
  const cutoff = Date.now() - minAgeMs;

  for await (const object of listObjects("workspaces/")) {
    if (!object.Key) continue;
    const jobId = jobIdFromKey(object.Key);
    if (!jobId) continue;
    if (object.LastModified && object.LastModified.getTime() > cutoff) continue;
    const workspacePrefix = object.Key.slice(0, object.Key.indexOf("/jobs/") + 1);
    prefixesByJob.set(jobId, `${workspacePrefix}jobs/${jobId}/`);
  }

  const jobIds = [...prefixesByJob.keys()];
  let removed = 0;

  for (let i = 0; i < jobIds.length; i += 500) {
    const chunk = jobIds.slice(i, i + 500);
    const existing = await prisma.generationJob.findMany({
      where: { id: { in: chunk } },
      select: { id: true },
    });
    const live = new Set(existing.map((j) => j.id));

    for (const jobId of chunk) {
      if (live.has(jobId)) continue;
      removed += await deletePrefix(prefixesByJob.get(jobId)!);
    }
  }

  return removed;
}

/**
 * Record a job's audit report as its ValidationResult, replacing any result
 * left by an earlier (crashed) run. Issues are stored in `errors` as
 * { table, column, type: "WARNING" | "ERROR", check, message, … }.
 */
export async function validateJob(
  id: string,
  report: AuditReport
): Promise<ValidationResult> {
  try {
    const [, result] = await prisma.$transaction([
      prisma.validationResult.deleteMany({ where: { jobId: id } }),
      prisma.validationResult.create({
        data: {
          jobId: id,
          isPassed: report.passed,
          summary: report.summary as unknown as Prisma.InputJsonValue,
          errors: report.issues as unknown as Prisma.InputJsonValue,
        },
      }),
    ]);
    return result;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new Error(`Failed to record validation result: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Mark a job as successfully completed.
 * Sets status → COMPLETED, progress = 100, records completedAt, exportUrl and
 * the health check outcome (true when the audit found no errors).
 */
export async function completeJob(
  id: string,
  exportUrl: string,
  fileSizeBytes?: number,
  healthCheckPassed?: boolean,
  exportFiles?: ExportFileFormat[]
): Promise<GenerationJob> {
  try {
    return await prisma.generationJob.update({
      where: { id },
      data: {
        status: JobStatus.COMPLETED,
        progress: 100,
        completedAt: new Date(),
        exportUrl,
        ...(fileSizeBytes !== undefined && { fileSizeBytes }),
        ...(healthCheckPassed !== undefined && { healthCheckPassed }),
        ...(exportFiles && { exportFiles: [...new Set(exportFiles)] }),
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2025") {
        throw new Error(`Generation job with id "${id}" not found.`);
      }
      throw new Error(`Failed to complete job: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Mark a job as failed and record the validation errors.
 * Sets status → FAILED and persists the errors JSON array.
 */
export async function failJob(
  id: string,
  errors: ValidationError[]
): Promise<GenerationJob> {
  try {
    return await prisma.generationJob.update({
      where: { id },
      data: {
        status: JobStatus.FAILED,
        validationErrors: errors as unknown as Prisma.InputJsonValue,
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2025") {
        throw new Error(`Generation job with id "${id}" not found.`);
      }
      throw new Error(`Failed to mark job as failed: ${error.message}`);
    }
    throw error;
  }
}

// ============================================
// Monitoring
// ============================================

/**
 * Return the current progress (0-100) for a job.
 * Throws if the job does not exist.
 */
export async function getJobProgress(jobId: string): Promise<number> {
  try {
    const job = await prisma.generationJob.findUnique({
      where: { id: jobId },
      select: { progress: true },
    });

    if (!job) {
      throw new Error(`Generation job with id "${jobId}" not found.`);
    }

    return job.progress;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new Error(`Failed to fetch job progress: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Return the most recent ValidationResult for a job, or null if none exists.
 */
export async function getJobValidation(
  jobId: string
): Promise<ValidationResult | null> {
  try {
    return await prisma.validationResult.findFirst({
      where: { jobId },
      orderBy: { createdAt: "desc" },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new Error(`Failed to fetch job validation: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Retrieve a job with all relations (workspace, schema, validationResults).
 * Returns null when not found.
 */
export async function getJobWithRelations(
  id: string
): Promise<GenerationJobWithRelations | null> {
  try {
    return await prisma.generationJob.findUnique({
      where: { id },
      include: {
        workspace: true,
        schema: true,
        validationResults: true,
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new Error(
        `Failed to fetch job with relations: ${error.message}`
      );
    }
    throw error;
  }
}
