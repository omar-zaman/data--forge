/**
 * Standalone BullMQ worker: consumes the generation queue, runs Faker generation
 * in batches (progress is written straight to MongoDB), audits the generated
 * data (referential integrity, null rates, uniqueness), uploads the artifacts to
 * S3/R2, and periodically sweeps orphaned export files. Document jobs are routed
 * to the PDF document engine; data jobs that request ExportFormat.PDF get a PDF
 * report rendered here (styled by the job's VisualTemplate, or the default
 * black-and-white layout), so PDF work never runs in the Next.js server.
 *
 * Run with: npm run worker
 */

import "./load-env";
import { UnrecoverableError, Worker, type Job } from "bullmq";
import {
  GENERATE_JOB,
  GENERATION_QUEUE_NAME,
  SWEEP_ORPHANS_JOB,
  createRedisConnection,
  getGenerationQueue,
  type GenerateJobPayload,
  type GenerationQueuePayload,
} from "@/lib/queue/client";
import {
  getJob,
  processJob,
  sweepOrphanedExports,
} from "@/lib/db/services/generation-job-service";
import { sweepStaleStaging } from "@/lib/engine/exporter";
import { processDocumentJob } from "@/lib/engine/document-engine";
import {
  DEFAULT_REPORT_THEME,
  renderDatasetReportPdf,
  resolveReportTheme,
  type ReportTheme,
} from "@/lib/engine/pdf-engine";
import { getTemplate } from "@/lib/db/services/visual-template-service";
import { disconnectPrisma } from "@/lib/db/prisma";

const CONCURRENCY = Math.max(1, Number(process.env.WORKER_CONCURRENCY) || 2);
const SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000;
const STALE_STAGING_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * The PDF report theme for a data job. A missing, deleted or foreign template
 * (or a lookup failure) falls back to the default layout instead of failing the job.
 */
async function loadReportTheme(templateId: string | null, userId: string): Promise<ReportTheme> {
  if (!templateId) return DEFAULT_REPORT_THEME;
  try {
    const template = await getTemplate(templateId);
    if (!template || template.userId !== userId) {
      console.warn(`[worker] Template ${templateId} unavailable, using the default report layout`);
      return DEFAULT_REPORT_THEME;
    }
    return resolveReportTheme(template.layoutConfig);
  } catch (error) {
    console.warn(`[worker] Failed to load template ${templateId}, using the default report layout:`, error);
    return DEFAULT_REPORT_THEME;
  }
}

async function handleGenerate(job: Job<GenerationQueuePayload>) {
  const { jobId, userId } = job.data as GenerateJobPayload;
  if (!jobId || !userId) {
    throw new UnrecoverableError("Malformed generate payload");
  }

  // Deleted before the worker got to it – nothing to do
  const record = await getJob(jobId);
  if (!record) {
    return { skipped: "job no longer exists" };
  }

  // DOCUMENT jobs (template snapshot + field mapping) render a PDF instead of CSV/SQL
  if (record.documentConfig) {
    const result = await processDocumentJob(jobId, userId);
    return { status: result.status, kind: "document", exportFiles: result.exportFiles };
  }

  // Generation, the in-memory health audit and publishing all run inside processJob;
  // the audit completes before the job is marked COMPLETED
  const theme =
    record.exportFormat === "PDF"
      ? await loadReportTheme(record.templateId, userId)
      : DEFAULT_REPORT_THEME;
  const result = await processJob(jobId, userId, {
    renderPdfReport: (input) => renderDatasetReportPdf({ ...input, theme }),
  });
  return {
    status: result.status,
    healthCheckPassed: result.healthCheckPassed,
    exportFormat: result.exportFormat,
  };
}

async function handleSweep() {
  const [objects, stagingDirs] = await Promise.all([
    sweepOrphanedExports(),
    sweepStaleStaging(STALE_STAGING_AGE_MS),
  ]);
  return { objects, stagingDirs };
}

async function main() {
  const worker = new Worker<GenerationQueuePayload>(
    GENERATION_QUEUE_NAME,
    async (job) => {
      switch (job.name) {
        case GENERATE_JOB:
          return handleGenerate(job);
        case SWEEP_ORPHANS_JOB:
          return handleSweep();
        default:
          throw new UnrecoverableError(`Unknown job type "${job.name}"`);
      }
    },
    {
      connection: createRedisConnection("worker"),
      concurrency: CONCURRENCY,
    }
  );

  worker.on("completed", (job, result) => {
    console.log(`[worker] ${job.name} ${job.id} completed`, result);
  });
  worker.on("failed", (job, error) => {
    console.error(`[worker] ${job?.name} ${job?.id} failed:`, error.message);
  });
  worker.on("error", (error) => {
    console.error("[worker] error:", error);
  });

  const queue = getGenerationQueue();
  await queue.upsertJobScheduler(
    SWEEP_ORPHANS_JOB,
    { every: SWEEP_INTERVAL_MS },
    { name: SWEEP_ORPHANS_JOB, data: {} }
  );

  console.log(
    `[worker] Listening on "${GENERATION_QUEUE_NAME}" (concurrency ${CONCURRENCY})`
  );

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[worker] ${signal} received, finishing active jobs...`);
    await worker.close();
    await queue.close();
    await disconnectPrisma();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((error) => {
  console.error("[worker] Failed to start:", error);
  process.exit(1);
});
