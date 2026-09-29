import os from "node:os";
import path from "node:path";
import { createWriteStream } from "node:fs";
import { mkdir, open, readdir, rm, stat, type FileHandle } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { ZipArchive } from "archiver";
import type { CellValue, GeneratedRow } from "@/lib/engine/tabular-engine";
import {
  deletePrefix,
  jobExportPrefix,
  listObjects,
  presignDownloadUrl,
  uploadFile,
  workspaceExportPrefix,
} from "@/lib/storage/s3";

// ============================================
// Types
// ============================================

export interface ExportColumn {
  key: string; // row key in GeneratedRow
  name: string; // raw column name from the schema
}

export interface TableExportWriter {
  /** Name the file gets inside the published artifact. */
  readonly fileName: string;
  readonly filePath: string;
  writeBatch(rows: GeneratedRow[]): Promise<void>;
  /** Finalizes the file and returns its size in bytes. */
  close(): Promise<number>;
  /** Closes the handle without finalizing (used on failure). */
  abort(): Promise<void>;
}

export class ExportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExportError";
  }
}

/** Raised when bundling the per-table exports into the ZIP archive fails. */
export class ArchiveError extends ExportError {
  constructor(message: string) {
    super(message);
    this.name = "ArchiveError";
  }
}

// ============================================
// Local staging paths (files are uploaded to S3/R2, then removed)
// ============================================

const STAGING_ROOT = path.join(os.tmpdir(), "dataforge-exports");
const OBJECT_ID_RE = /^[a-f0-9]{24}$/i;

/** Resolves `segments` under the staging root, rejecting anything that escapes it. */
function resolveInsideStaging(...segments: string[]): string {
  const resolved = path.resolve(STAGING_ROOT, ...segments);
  const relative = path.relative(STAGING_ROOT, resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new ExportError("Resolved export path escapes the staging directory");
  }
  return resolved;
}

function assertJobId(jobId: string): void {
  if (!OBJECT_ID_RE.test(jobId)) {
    throw new ExportError(`Invalid job id "${jobId}"`);
  }
}

export function getJobStagingDir(jobId: string): string {
  assertJobId(jobId);
  return resolveInsideStaging(jobId);
}

/** Restricts a file base name to [A-Za-z0-9_-] so it can't carry path separators or dots. */
export function sanitizeFileName(name: string, fallback = "data"): string {
  const cleaned = name.replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 64);
  return cleaned || fallback;
}

/** Removes a job's local staging files. */
export async function removeJobStaging(jobId: string): Promise<void> {
  await rm(getJobStagingDir(jobId), { recursive: true, force: true });
}

/** Removes staging dirs left behind by crashed workers. Returns how many were removed. */
export async function sweepStaleStaging(maxAgeMs: number): Promise<number> {
  const entries = await readdir(STAGING_ROOT, { withFileTypes: true }).catch(() => []);
  let removed = 0;
  for (const entry of entries) {
    if (!entry.isDirectory() || !OBJECT_ID_RE.test(entry.name)) continue;
    const dir = resolveInsideStaging(entry.name);
    const { mtimeMs } = await stat(dir);
    if (Date.now() - mtimeMs > maxAgeMs) {
      await rm(dir, { recursive: true, force: true });
      removed++;
    }
  }
  return removed;
}

// ============================================
// Bucket cleanup
// ============================================

export async function deleteJobExports(workspaceId: string, jobId: string): Promise<number> {
  return deletePrefix(jobExportPrefix(workspaceId, jobId));
}

export async function deleteWorkspaceExports(workspaceId: string): Promise<number> {
  return deletePrefix(workspaceExportPrefix(workspaceId));
}

// ============================================
// CSV conversion
// ============================================

// Spreadsheet apps evaluate cells starting with these as formulas (CSV injection)
const FORMULA_TRIGGER_RE = /^[=+\-@\t\r]/;

/** Neutralizes formula triggers by prefixing a single quote (OWASP recommendation). */
function neutralizeFormula(value: string): string {
  return FORMULA_TRIGGER_RE.test(value) ? `'${value}` : value;
}

function quoteCsv(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Sanitizes a schema column name for use as a CSV header. */
export function sanitizeCsvHeader(name: string): string {
  // Strip control characters, then neutralize formula triggers
  const cleaned = name.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return quoteCsv(neutralizeFormula(cleaned));
}

function formatCsvCell(value: CellValue | undefined): string {
  if (value === null || value === undefined) return "";
  // Numbers/booleans are safe as-is; only free-form strings can carry formulas
  if (typeof value !== "string") return String(value);
  return quoteCsv(neutralizeFormula(value));
}

export function csvHeaderLine(columns: ExportColumn[]): string {
  return columns.map((c) => sanitizeCsvHeader(c.name)).join(",") + "\r\n";
}

export function rowsToCsv(rows: GeneratedRow[], columns: ExportColumn[]): string {
  let out = "";
  for (const row of rows) {
    out += columns.map((c) => formatCsvCell(row[c.key])).join(",") + "\r\n";
  }
  return out;
}

// ============================================
// Streaming file writer
// ============================================

/**
 * Opens `<staging>/<jobId>/<fileBase>.csv` and appends batches as they are
 * generated, so memory stays bounded by the batch size instead of rowCount.
 */
export async function createTableExportWriter(
  jobId: string,
  fileBase: string,
  columns: ExportColumn[]
): Promise<TableExportWriter> {
  const dir = getJobStagingDir(jobId);
  await mkdir(dir, { recursive: true });

  const fileName = `${sanitizeFileName(fileBase)}.csv`;
  const csvPath = resolveInsideStaging(jobId, fileName);
  const handle: FileHandle = await open(csvPath, "w");
  await handle.write(csvHeaderLine(columns));

  let closed = false;
  const closeHandle = async () => {
    if (closed) return;
    closed = true;
    await handle.close().catch(() => undefined);
  };

  return {
    fileName,
    filePath: csvPath,

    async writeBatch(rows) {
      if (rows.length === 0) return;
      await handle.write(rowsToCsv(rows, columns));
    },

    async close() {
      await closeHandle();
      return (await stat(csvPath)).size;
    },

    abort: closeHandle,
  };
}

// ============================================
// JSON array writer
// ============================================

/**
 * Opens `<staging>/<jobId>/<fileBase>.json` and streams rows into a JSON array
 * of objects keyed by column name, so memory stays bounded by the batch size.
 */
export async function createJsonExportWriter(
  jobId: string,
  fileBase: string,
  columns: ExportColumn[]
): Promise<TableExportWriter> {
  const dir = getJobStagingDir(jobId);
  await mkdir(dir, { recursive: true });

  const fileName = `${sanitizeFileName(fileBase)}.json`;
  const jsonPath = resolveInsideStaging(jobId, fileName);
  const handle: FileHandle = await open(jsonPath, "w");
  await handle.write("[");

  let closed = false;
  let first = true;
  const closeHandle = async () => {
    if (closed) return;
    closed = true;
    await handle.close().catch(() => undefined);
  };

  return {
    fileName,
    filePath: jsonPath,

    async writeBatch(rows) {
      if (rows.length === 0) return;
      let out = "";
      for (const row of rows) {
        const record: Record<string, CellValue> = {};
        for (const c of columns) record[c.name] = row[c.key] ?? null;
        // JSON.stringify maps non-finite numbers to null
        out += (first ? "\n  " : ",\n  ") + JSON.stringify(record);
        first = false;
      }
      await handle.write(out);
    },

    async close() {
      if (!closed) await handle.write(first ? "]\n" : "\n]\n");
      await closeHandle();
      return (await stat(jsonPath)).size;
    },

    abort: closeHandle,
  };
}

// ============================================
// SQL relational dump (ANSI SQL for PostgreSQL and MySQL 8+)
// ============================================

export const SQL_DUMP_FILE_NAME = "schema_and_data.sql";
export const CSV_ARCHIVE_FILE_NAME = "dataset.zip";

/** Rows per INSERT statement: keeps statements well under MySQL's max_allowed_packet. */
const SQL_INSERT_BATCH = 500;
const SQL_IDENTIFIER_MAX = 63; // PostgreSQL's limit (MySQL allows 64)

type ReferentialAction = "CASCADE" | "SET_NULL" | "RESTRICT" | "NO_ACTION";

export interface SqlColumn extends ExportColumn {
  type: string; // UIDataType string
  nullable: boolean;
  isPrimaryKey?: boolean;
  isUnique?: boolean;
}

export interface SqlForeignKey {
  fromColumn: string;
  toTable: string;
  toColumn: string;
  onDelete?: ReferentialAction;
  onUpdate?: ReferentialAction;
}

export interface SqlTable {
  name: string;
  columns: SqlColumn[];
  foreignKeys: SqlForeignKey[];
}

export interface SqlDumpWriter {
  readonly fileName: string;
  readonly filePath: string;
  /** Appends batched INSERT statements for `table` (tables must arrive in dependency order). */
  writeBatch(table: string, rows: GeneratedRow[]): Promise<void>;
  /** Writes the closing statements and returns the file size in bytes. */
  close(): Promise<number>;
  abort(): Promise<void>;
}

const SQL_TYPES: Record<string, string> = {
  UUID: "CHAR(36)",
  Integer: "INTEGER",
  Float: "NUMERIC(12, 2)",
  Boolean: "BOOLEAN",
  Date: "DATE",
  DateTime: "TIMESTAMP",
  Text: "TEXT",
};

/** Keys must be indexable in MySQL, which rules out TEXT. */
function sqlType(type: string, indexed: boolean): string {
  const mapped = SQL_TYPES[type] ?? "VARCHAR(255)";
  return mapped === "TEXT" && indexed ? "VARCHAR(255)" : mapped;
}

/** Double-quoted identifier (ANSI; MySQL reads it under ANSI_QUOTES, set in the dump preamble). */
function quoteIdent(name: string): string {
  const cleaned = name.replace(/[\u0000-\u001f\u007f]/g, "");
  if (!cleaned) throw new ExportError("SQL identifiers cannot be empty");
  return `"${cleaned.replace(/"/g, '""')}"`;
}

/**
 * Standard SQL string literal: single quotes are doubled and NUL bytes dropped
 * (PostgreSQL rejects them). Backslashes stay literal in both engines because
 * the preamble turns on NO_BACKSLASH_ESCAPES for MySQL.
 */
export function quoteSqlString(value: string): string {
  return `'${value.replace(/\u0000/g, "").replace(/'/g, "''")}'`;
}

const ISO_DATETIME_RE = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})(?:\.\d+)?Z$/;

function formatSqlValue(value: CellValue | undefined, type: string): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
  if (type === "DateTime") {
    // Both engines accept 'YYYY-MM-DD HH:MM:SS'; MySQL rejects the ISO "T…Z" form
    const m = ISO_DATETIME_RE.exec(value);
    if (m) return quoteSqlString(`${m[1]} ${m[2]}`);
  }
  return quoteSqlString(value);
}

/** CREATE TABLE statements with PK/FK constraints, for tables in dependency order. */
export function buildSqlSchema(tables: SqlTable[]): string {
  const byName = new Map(tables.map((t) => [t.name, t]));
  const usedNames = new Set<string>();
  const constraintName = (raw: string) => {
    const base = raw.replace(/[^A-Za-z0-9_]+/g, "_").slice(0, SQL_IDENTIFIER_MAX - 4);
    let name = base;
    for (let i = 2; usedNames.has(name.toLowerCase()); i++) name = `${base}_${i}`;
    usedNames.add(name.toLowerCase());
    return quoteIdent(name);
  };

  return tables
    .map((table) => {
      const fkByColumn = new Map(table.foreignKeys.map((fk) => [fk.fromColumn, fk]));
      const lines: string[] = [];

      for (const col of table.columns) {
        const fk = fkByColumn.get(col.name);
        // FK columns take the referenced column's type so the constraint is valid
        const target =
          fk && byName.get(fk.toTable)?.columns.find((c) => c.name === fk.toColumn);
        const type = sqlType(
          target?.type ?? col.type,
          Boolean(fk || col.isPrimaryKey || col.isUnique)
        );
        const notNull = col.isPrimaryKey || !col.nullable ? " NOT NULL" : "";
        const unique = col.isUnique && !col.isPrimaryKey ? " UNIQUE" : "";
        lines.push(`  ${quoteIdent(col.name)} ${type}${notNull}${unique}`);
      }

      const pk = table.columns.find((c) => c.isPrimaryKey);
      if (pk) {
        lines.push(
          `  CONSTRAINT ${constraintName(`pk_${table.name}`)} PRIMARY KEY (${quoteIdent(pk.name)})`
        );
      }

      for (const fk of table.foreignKeys) {
        const col = table.columns.find((c) => c.name === fk.fromColumn);
        // SET NULL is only valid on nullable columns
        const allowed = (action?: ReferentialAction): action is ReferentialAction =>
          !!action && !(action === "SET_NULL" && (col?.isPrimaryKey || !col?.nullable));

        let clause =
          `  CONSTRAINT ${constraintName(`fk_${table.name}_${fk.fromColumn}`)} ` +
          `FOREIGN KEY (${quoteIdent(fk.fromColumn)}) ` +
          `REFERENCES ${quoteIdent(fk.toTable)} (${quoteIdent(fk.toColumn)})`;
        if (allowed(fk.onDelete)) clause += ` ON DELETE ${fk.onDelete.replace("_", " ")}`;
        if (allowed(fk.onUpdate)) clause += ` ON UPDATE ${fk.onUpdate.replace("_", " ")}`;
        lines.push(clause);
      }

      return `CREATE TABLE ${quoteIdent(table.name)} (\n${lines.join(",\n")}\n);\n`;
    })
    .join("\n");
}

/** INSERT statements of up to SQL_INSERT_BATCH rows each. */
export function rowsToSqlInserts(table: SqlTable, rows: GeneratedRow[]): string {
  if (rows.length === 0) return "";
  const head =
    `INSERT INTO ${quoteIdent(table.name)} (` +
    table.columns.map((c) => quoteIdent(c.name)).join(", ") +
    ") VALUES\n";

  let out = "";
  for (let i = 0; i < rows.length; i += SQL_INSERT_BATCH) {
    const values = rows
      .slice(i, i + SQL_INSERT_BATCH)
      .map(
        (row) =>
          `  (${table.columns.map((c) => formatSqlValue(row[c.key], c.type)).join(", ")})`
      );
    out += head + values.join(",\n") + ";\n\n";
  }
  return out;
}

function sqlPreamble(tables: SqlTable[]): string {
  return [
    "-- DataForge relational dump",
    `-- Generated: ${new Date().toISOString()}`,
    `-- Tables (dependency order): ${tables.map((t) => t.name).join(", ")}`,
    "--",
    "-- ANSI SQL for PostgreSQL and MySQL 8+. The versioned comment below runs only",
    "-- in MySQL (PostgreSQL treats it as a comment): it enables standard double-quoted",
    "-- identifiers and standard string escaping for this session.",
    "",
    "/*!40101 SET @DATAFORGE_OLD_SQL_MODE = @@SQL_MODE, SQL_MODE = 'ANSI_QUOTES,NO_BACKSLASH_ESCAPES,STRICT_TRANS_TABLES' */;",
    "",
    // Children first so no drop is blocked by a foreign key
    ...tables
      .slice()
      .reverse()
      .map((t) => `DROP TABLE IF EXISTS ${quoteIdent(t.name)};`),
    "",
    buildSqlSchema(tables),
    "START TRANSACTION;",
    "",
    "",
  ].join("\n");
}

const SQL_EPILOGUE = [
  "COMMIT;",
  "",
  "/*!40101 SET SQL_MODE = @DATAFORGE_OLD_SQL_MODE */;",
  "",
].join("\n");

/**
 * Opens `<staging>/<jobId>/schema_and_data.sql`, writes the DDL up front and
 * appends INSERT batches as rows are generated.
 */
export async function createSqlDumpWriter(
  jobId: string,
  tables: SqlTable[]
): Promise<SqlDumpWriter> {
  const dir = getJobStagingDir(jobId);
  await mkdir(dir, { recursive: true });

  const byName = new Map(tables.map((t) => [t.name, t]));
  const filePath = resolveInsideStaging(jobId, SQL_DUMP_FILE_NAME);
  const handle: FileHandle = await open(filePath, "w");

  let closed = false;
  const closeHandle = async () => {
    if (closed) return;
    closed = true;
    await handle.close().catch(() => undefined);
  };

  try {
    await handle.write(sqlPreamble(tables));
  } catch (error) {
    await closeHandle();
    throw error;
  }

  return {
    fileName: SQL_DUMP_FILE_NAME,
    filePath,

    async writeBatch(tableName, rows) {
      const table = byName.get(tableName);
      if (!table) throw new ExportError(`Unknown SQL export table "${tableName}"`);
      await handle.write(rowsToSqlInserts(table, rows));
    },

    async close() {
      if (!closed) await handle.write(SQL_EPILOGUE);
      await closeHandle();
      return (await stat(filePath)).size;
    },

    abort: closeHandle,
  };
}

// ============================================
// Publishing
// ============================================

export type ExportFileFormat = "csv" | "zip" | "sql" | "pdf";

export interface PublishedExport {
  key: string;
  fileName: string;
  format: ExportFileFormat;
  /** Presigned GET URL, valid for 24 hours. */
  url: string;
  sizeBytes: number;
}

const CONTENT_TYPES: Record<ExportFileFormat, string> = {
  csv: "text/csv; charset=utf-8",
  zip: "application/zip",
  sql: "application/sql; charset=utf-8",
  pdf: "application/pdf",
};

async function zipFiles(
  files: { name: string; path: string }[],
  outPath: string
): Promise<void> {
  try {
    const archive = new ZipArchive({ zlib: { level: 6 } });
    const written = pipeline(archive, createWriteStream(outPath));
    for (const file of files) archive.file(file.path, { name: file.name });
    await Promise.all([archive.finalize(), written]);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new ArchiveError(`Failed to build the ZIP archive: ${reason}`);
  }
}

async function publishFile(
  workspaceId: string,
  jobId: string,
  fileName: string,
  filePath: string,
  format: ExportFileFormat
): Promise<PublishedExport> {
  const key = `${jobExportPrefix(workspaceId, jobId)}${fileName}`;
  const sizeBytes = await uploadFile(key, filePath, CONTENT_TYPES[format], fileName);
  const url = await presignDownloadUrl(key);
  return { key, fileName, format, url, sizeBytes };
}

/**
 * Uploads a job's finished files to the private bucket. Every job gets
 * dataset.zip bundling one CSV and one JSON array file per table plus the SQL
 * dump. A single-table job additionally publishes its plain CSV, which becomes
 * the primary export; otherwise the ZIP is. The SQL dump, when given, is also
 * published on its own. `primary` is the export whose URL is stored on the job.
 */
export async function publishJobExport(
  workspaceId: string,
  jobId: string,
  downloadBase: string,
  writers: TableExportWriter[],
  sqlWriter?: SqlDumpWriter,
  jsonWriters: TableExportWriter[] = []
): Promise<{ primary: PublishedExport; files: PublishedExport[] }> {
  if (writers.length === 0) {
    throw new ExportError("No export files to publish");
  }

  const zipPath = resolveInsideStaging(jobId, `__${CSV_ARCHIVE_FILE_NAME}`);
  await zipFiles(
    [...writers, ...jsonWriters, ...(sqlWriter ? [sqlWriter] : [])].map((w) => ({
      name: w.fileName,
      path: w.filePath,
    })),
    zipPath
  );
  const zip = await publishFile(workspaceId, jobId, CSV_ARCHIVE_FILE_NAME, zipPath, "zip");

  const files = [zip];
  let primary = zip;
  if (writers.length === 1) {
    const fileName = `${sanitizeFileName(downloadBase, "export")}.csv`;
    primary = await publishFile(workspaceId, jobId, fileName, writers[0].filePath, "csv");
    files.unshift(primary);
  }

  if (sqlWriter) {
    files.push(
      await publishFile(workspaceId, jobId, sqlWriter.fileName, sqlWriter.filePath, "sql")
    );
  }
  return { primary, files };
}

/** Finds a job's published file of `format` and signs a fresh download URL for it. */
export async function getJobExportDownload(
  workspaceId: string,
  jobId: string,
  format: ExportFileFormat
): Promise<{ url: string; fileName: string } | null> {
  const prefix = jobExportPrefix(workspaceId, jobId);
  for await (const object of listObjects(prefix)) {
    const fileName = object.Key?.slice(prefix.length);
    if (!fileName || fileName.includes("/") || fileName.startsWith("__")) continue;
    if (fileName.toLowerCase().endsWith(`.${format}`)) {
      return { url: await presignDownloadUrl(object.Key!), fileName };
    }
  }
  return null;
}
