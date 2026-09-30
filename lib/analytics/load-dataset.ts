/**
 * Loads a completed job's generated rows back from storage for the analytics
 * dashboard. Prefers the standalone JSON export, then the single-table CSV,
 * then the per-table JSON (or CSV) files bundled in dataset.zip. Large tables
 * are down-sampled with an even stride so the payload stays chart-sized.
 */

import { inflateRawSync } from "node:zlib";
import { findJobExport } from "@/lib/engine/exporter";
import { getObjectStream } from "@/lib/storage/s3";

export type DatasetValue = string | number | boolean | null;
export type DatasetRow = Record<string, DatasetValue>;

export interface DatasetTable {
  name: string;
  /** Rows in the stored file, before sampling. */
  totalRows: number;
  rows: DatasetRow[];
}

export interface JobDataset {
  source: "json" | "csv" | "zip";
  sampled: boolean;
  tables: DatasetTable[];
}

/** Rows kept per table; charts aggregate client-side, so this bounds the payload. */
export const MAX_ROWS_PER_TABLE = 5000;
/** Refuse to buffer artifacts larger than this into memory. */
const MAX_ARTIFACT_BYTES = 64 * 1024 * 1024;

export class DatasetTooLargeError extends Error {}

async function readObject(key: string): Promise<Buffer> {
  const { body } = await getObjectStream(key);
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_ARTIFACT_BYTES) {
      await reader.cancel();
      throw new DatasetTooLargeError("The dataset is too large to analyze in the browser");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

// ============================================
// Parsing
// ============================================

function toValue(raw: unknown): DatasetValue {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "string" || typeof raw === "number" || typeof raw === "boolean") return raw;
  return JSON.stringify(raw);
}

function parseJsonRows(text: string): DatasetRow[] {
  const parsed: unknown = JSON.parse(text);
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter((r): r is Record<string, unknown> => !!r && typeof r === "object" && !Array.isArray(r))
    .map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, toValue(v)])));
}

/** CSV cells come back as strings; restore numbers and booleans. */
function coerceCsvCell(cell: string): DatasetValue {
  if (cell === "") return null;
  if (cell === "true") return true;
  if (cell === "false") return false;
  if (/^-?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(cell.trim())) {
    const n = Number(cell);
    if (Number.isFinite(n)) return n;
  }
  return cell;
}

/** RFC 4180 parser: quoted fields, escaped quotes, embedded newlines. */
function parseCsvRows(text: string): DatasetRow[] {
  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let quoted = false;
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      record.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      record.push(field);
      records.push(record);
      record = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || record.length > 0) {
    record.push(field);
    records.push(record);
  }

  const [header, ...body] = records;
  if (!header) return [];
  return body
    .filter((r) => !(r.length === 1 && r[0] === ""))
    .map((r) => Object.fromEntries(header.map((h, i) => [h, coerceCsvCell(r[i] ?? "")])));
}

// ============================================
// Minimal ZIP reader (stored + deflate, no ZIP64)
// ============================================

interface ZipEntry {
  name: string;
  data: () => Buffer;
}

function readZipEntries(zip: Buffer): ZipEntry[] {
  // End of central directory: fixed 22 bytes plus a comment of up to 64 KiB
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 0xffff); i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) throw new Error("Invalid ZIP archive");

  const count = zip.readUInt16LE(eocd + 10);
  let offset = zip.readUInt32LE(eocd + 16);
  const entries: ZipEntry[] = [];

  for (let n = 0; n < count; n++) {
    if (zip.readUInt32LE(offset) !== 0x02014b50) throw new Error("Corrupt ZIP directory");
    const method = zip.readUInt16LE(offset + 10);
    const compressedSize = zip.readUInt32LE(offset + 20);
    const nameLen = zip.readUInt16LE(offset + 28);
    const extraLen = zip.readUInt16LE(offset + 30);
    const commentLen = zip.readUInt16LE(offset + 32);
    const localOffset = zip.readUInt32LE(offset + 42);
    const name = zip.toString("utf8", offset + 46, offset + 46 + nameLen);
    offset += 46 + nameLen + extraLen + commentLen;

    entries.push({
      name,
      data: () => {
        const localNameLen = zip.readUInt16LE(localOffset + 26);
        const localExtraLen = zip.readUInt16LE(localOffset + 28);
        const start = localOffset + 30 + localNameLen + localExtraLen;
        const raw = zip.subarray(start, start + compressedSize);
        if (method === 0) return raw;
        if (method === 8) return inflateRawSync(raw);
        throw new Error(`Unsupported ZIP compression method ${method}`);
      },
    });
  }
  return entries;
}

// ============================================
// Loading
// ============================================

function tableName(fileName: string): string {
  const base = fileName.slice(fileName.lastIndexOf("/") + 1);
  return base.replace(/\.(json|csv)$/i, "");
}

function sampleTable(name: string, rows: DatasetRow[]): DatasetTable {
  if (rows.length <= MAX_ROWS_PER_TABLE) return { name, totalRows: rows.length, rows };
  const stride = rows.length / MAX_ROWS_PER_TABLE;
  const sampled: DatasetRow[] = [];
  for (let i = 0; i < MAX_ROWS_PER_TABLE; i++) sampled.push(rows[Math.floor(i * stride)]);
  return { name, totalRows: rows.length, rows: sampled };
}

/** Returns null when the job has no tabular export (e.g. PDF document jobs). */
export async function loadJobDataset(
  workspaceId: string,
  jobId: string
): Promise<JobDataset | null> {
  const json = await findJobExport(workspaceId, jobId, "json");
  if (json) {
    const rows = parseJsonRows((await readObject(json.key)).toString("utf8"));
    const table = sampleTable(tableName(json.fileName), rows);
    return { source: "json", sampled: table.rows.length < table.totalRows, tables: [table] };
  }

  const csv = await findJobExport(workspaceId, jobId, "csv");
  if (csv) {
    const rows = parseCsvRows((await readObject(csv.key)).toString("utf8"));
    const table = sampleTable(tableName(csv.fileName), rows);
    return { source: "csv", sampled: table.rows.length < table.totalRows, tables: [table] };
  }

  const zip = await findJobExport(workspaceId, jobId, "zip");
  if (!zip) return null;

  const entries = readZipEntries(await readObject(zip.key));
  const jsonEntries = entries.filter((e) => /\.json$/i.test(e.name));
  const csvEntries = entries.filter((e) => /\.csv$/i.test(e.name));
  const tables =
    jsonEntries.length > 0
      ? jsonEntries.map((e) => sampleTable(tableName(e.name), parseJsonRows(e.data().toString("utf8"))))
      : csvEntries.map((e) => sampleTable(tableName(e.name), parseCsvRows(e.data().toString("utf8"))));
  if (tables.length === 0) return null;

  return {
    source: "zip",
    sampled: tables.some((t) => t.rows.length < t.totalRows),
    tables,
  };
}
