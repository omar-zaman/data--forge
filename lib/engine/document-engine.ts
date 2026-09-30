/**
 * Document Engine: runs DOCUMENT generation jobs in the worker.
 *
 *   relational generation (in memory) → one invoice / statement model per
 *   header-table row, with its child rows as line items → React-PDF stream →
 *   buffer → private S3/R2 object → presigned exportUrl on the job.
 *
 * Only the worker imports this module, so @react-pdf/renderer never ends up in
 * the Next.js route bundles.
 */

import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { JobStatus, Prisma } from "@prisma/client";
import prisma from "@/lib/db/prisma";
import type { GenerationJob, TableStructure } from "@/types/database";
import {
  completeJob,
  exportFormatToFile,
  failJob,
  getJob,
} from "@/lib/db/services/generation-job-service";
import { TabularEngineError, hashSeed, randomSeed, type CellValue, type GeneratedRow } from "@/lib/engine/tabular-engine";
import {
  createRelationalTableGenerator,
  planRelationalSchema,
  tableSeed,
  tableStructuresToRelationalInput,
  type KeyPools,
} from "@/lib/engine/relational-engine";
import { resolveFakerLocale } from "@/lib/engine/locale";
import {
  ExportError,
  deleteJobExports,
  publishDocumentExport,
  removeJobStaging,
} from "@/lib/engine/exporter";
import { StorageError } from "@/lib/storage/s3";
import {
  DOCUMENT_DEFAULT_COUNT,
  DOCUMENT_MAX_COUNT,
  findLineLink,
  readDocumentLayout,
  validateDocumentMapping,
  type DocumentJobConfig,
  type DocumentLayoutFields,
  type DocumentMapping,
} from "@/lib/validations/document-template";
import {
  renderDocumentPdf,
  renderEachDocumentPdf,
  type DocumentModel,
  type InvoiceItem,
  type PdfLayout,
  type PdfLogo,
  type StatementTransaction,
} from "@/lib/engine/pdf-engine";

// ============================================
// Limits
// ============================================

/** Cap for every other table generated alongside the header table (line items, lookups). */
const DOCUMENT_MAX_TABLE_ROWS = 50_000;
/** Line items / transactions printed per document (the most relevant ones are kept). */
const MAX_LINES_PER_DOCUMENT = 200;
const LOGO_MAX_BYTES = 2 * 1024 * 1024;
const LOGO_TIMEOUT_MS = 5_000;

export class DocumentEngineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocumentEngineError";
  }
}

// ============================================
// Value coercion
// ============================================

function toText(value: CellValue | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  const text = String(value).trim();
  return text === "" ? null : text;
}

function toNumber(value: CellValue | undefined): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value.replace(/[^0-9.+-]/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

const dateFormat = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

function toTime(value: CellValue | undefined): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : null;
}

function toDateText(value: CellValue | undefined): string | null {
  const t = toTime(value);
  return t === null ? toText(value) : dateFormat.format(t);
}

// ============================================
// Models
// ============================================

interface Bound {
  header: GeneratedRow;
  lines: GeneratedRow[];
}

/** Reads a mapped column from a row; unmapped keys yield undefined. */
function field(mapping: DocumentMapping, row: GeneratedRow, key: string): CellValue | undefined {
  const column = mapping.fields[key];
  return column ? row[column] : undefined;
}

function buildInvoice(mapping: DocumentMapping, { header, lines }: Bound, index: number): DocumentModel {
  const get = (key: string) => field(mapping, header, key);

  // Totals are computed from the printed rows only, so the invoice always adds up
  const items: InvoiceItem[] = lines.slice(0, MAX_LINES_PER_DOCUMENT).map((line) => {
    const quantity = toNumber(field(mapping, line, "item_quantity"));
    const unitPrice = toNumber(field(mapping, line, "item_unit_price"));
    const amount =
      toNumber(field(mapping, line, "item_amount")) ??
      (quantity !== null && unitPrice !== null ? quantity * unitPrice : unitPrice ?? 0);
    return {
      description: toText(field(mapping, line, "item_description")) ?? "Item",
      quantity,
      unitPrice,
      amount: round2(amount),
    };
  });

  const subtotal = round2(items.reduce((sum, item) => sum + item.amount, 0));
  const taxValue = toNumber(get("tax_amount"));
  const tax = mapping.fields.tax_amount ? round2(taxValue ?? 0) : null;
  // A mapped total wins; otherwise the invoice is internally consistent
  const mappedTotal = toNumber(get("total_amount"));
  const total = round2(mappedTotal ?? subtotal + (tax ?? 0));

  return {
    kind: "invoice",
    number: toText(get("invoice_number")) ?? `INV-${String(index + 1).padStart(5, "0")}`,
    issueDate: toDateText(get("issue_date")) ?? "—",
    dueDate: toDateText(get("due_date")),
    customer: {
      name: toText(get("customer_name")) ?? "—",
      email: toText(get("customer_email")),
      address: toText(get("customer_address")),
    },
    notes: toText(get("notes")),
    items,
    subtotal,
    tax,
    total,
  };
}

function buildStatement(
  mapping: DocumentMapping,
  { header, lines }: Bound,
  seed: number,
  signAmounts: boolean
): DocumentModel {
  const get = (key: string) => field(mapping, header, key);
  const accountNumber = toText(get("account_number")) ?? "—";

  // Chronological ledger of the most recent transactions
  const entries = lines
    .map((line, i) => ({ line, i, t: toTime(field(mapping, line, "txn_date")) }))
    .sort((a, b) => (a.t ?? 0) - (b.t ?? 0) || a.i - b.i)
    .slice(-MAX_LINES_PER_DOCUMENT)
    .map(({ line, i, t }) => {
      let amount = toNumber(field(mapping, line, "txn_amount")) ?? 0;
      // Faker amounts are never negative; turn most of them into debits so the
      // ledger reads like a real account (deterministic per seed and row)
      if (signAmounts && hashSeed(seed, `sign:${accountNumber}:${i}`) % 100 < 65) amount = -amount;
      return { line, t, amount: round2(amount) };
    });

  // Unmapped opening balances are seeded (reruns are identical) and large
  // enough that the running balance never dips below zero
  let lowestRunning = 0;
  let running = 0;
  for (const { amount } of entries) {
    running += amount;
    lowestRunning = Math.min(lowestRunning, running);
  }
  const mappedOpening = toNumber(get("opening_balance"));
  const opening = round2(
    mappedOpening ?? 250 + (hashSeed(seed, `open:${accountNumber}`) % 500_000) / 100 - lowestRunning
  );

  let balance = opening;
  let credits = 0;
  let debits = 0;
  const transactions: StatementTransaction[] = entries.map(({ line, amount }) => {
    balance = round2(balance + amount);
    if (amount >= 0) credits += amount;
    else debits -= amount;
    return {
      date: toDateText(field(mapping, line, "txn_date")) ?? "—",
      description: toText(field(mapping, line, "txn_description")) ?? "Transaction",
      reference: toText(field(mapping, line, "txn_reference")),
      amount,
      balance,
    };
  });
  const times = entries.map((e) => e.t).filter((t): t is number => t !== null);

  return {
    kind: "statement",
    accountNumber,
    holder: toText(get("account_holder")) ?? "—",
    address: toText(get("holder_address")),
    statementDate: toDateText(get("statement_date")) ?? "—",
    period: times.length
      ? `${dateFormat.format(Math.min(...times))} – ${dateFormat.format(Math.max(...times))}`
      : null,
    openingBalance: opening,
    closingBalance: balance,
    totalCredits: round2(credits),
    totalDebits: round2(debits),
    transactions,
  };
}

/**
 * Groups line rows under their header row (via the line table's FK) and builds
 * one invoice / statement model per header row, in generation order.
 */
export function buildDocumentModels({
  layout,
  mapping,
  headerRows,
  lineRows,
  link,
  seed,
}: {
  layout: DocumentLayoutFields;
  mapping: DocumentMapping;
  headerRows: GeneratedRow[];
  lineRows: GeneratedRow[];
  link: { fromColumn: string; toColumn: string } | null;
  seed: number;
}): DocumentModel[] {
  const linesByParent = new Map<CellValue, GeneratedRow[]>();
  if (link) {
    for (const row of lineRows) {
      const parent = row[link.fromColumn];
      if (parent === null || parent === undefined) continue;
      const list = linesByParent.get(parent) ?? [];
      list.push(row);
      linesByParent.set(parent, list);
    }
  }
  const bound: Bound[] = headerRows.map((header) => ({
    header,
    lines: link ? linesByParent.get(header[link.toColumn]) ?? [] : [],
  }));

  const signAmounts =
    layout.documentType === "statement" &&
    !lineRows.some((row) => (toNumber(field(mapping, row, "txn_amount")) ?? 0) < 0);
  return bound.map((b, i) =>
    layout.documentType === "invoice"
      ? buildInvoice(mapping, b, i)
      : buildStatement(mapping, b, seed, signAmounts)
  );
}

// ============================================
// Logo (fetched once per job, defensively)
// ============================================

const PRIVATE_RANGES = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.168.0.0", 16], ["224.0.0.0", 4],
] as const) {
  PRIVATE_RANGES.addSubnet(net, prefix, "ipv4");
}
for (const [net, prefix] of [["::", 128], ["::1", 128], ["fc00::", 7], ["fe80::", 10]] as const) {
  PRIVATE_RANGES.addSubnet(net, prefix, "ipv6");
}

function isPrivateAddress(address: string): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (mapped) return PRIVATE_RANGES.check(mapped[1], "ipv4");
  return PRIVATE_RANGES.check(address, isIP(address) === 6 ? "ipv6" : "ipv4");
}

function sniffImageFormat(data: Buffer): PdfLogo["format"] | null {
  if (data.length > 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "png";
  }
  if (data.length > 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "jpg";
  return null;
}

/**
 * Downloads the template logo (https only, public addresses only, no
 * redirects, ≤ 2 MB, PNG/JPEG only). Any problem just renders without a logo.
 */
async function fetchLogo(url: string | undefined): Promise<PdfLogo | null> {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return null;
    const addresses = await lookup(parsed.hostname.replace(/^\[|\]$/g, ""), { all: true });
    if (addresses.length === 0 || addresses.some((a) => isPrivateAddress(a.address))) return null;

    const res = await fetch(parsed, { redirect: "error", signal: AbortSignal.timeout(LOGO_TIMEOUT_MS) });
    if (!res.ok || !res.body) return null;
    if (Number(res.headers.get("content-length")) > LOGO_MAX_BYTES) return null;

    const chunks: Uint8Array[] = [];
    let size = 0;
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > LOGO_MAX_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
    const data = Buffer.concat(chunks);
    const format = sniffImageFormat(data);
    return format ? { data, format } : null;
  } catch (error) {
    console.warn(`[documents] Logo "${url}" could not be loaded:`, error instanceof Error ? error.message : error);
    return null;
  }
}

// ============================================
// Job processing
// ============================================

function parseTables(raw: Prisma.JsonValue): TableStructure[] {
  if (!Array.isArray(raw)) return [];
  return (raw as unknown as Partial<TableStructure>[]).filter(
    (t): t is TableStructure => Array.isArray(t?.columns) && t.columns.length > 0
  );
}

async function setProgress(id: string, progress: number): Promise<void> {
  await prisma.generationJob.update({ where: { id }, data: { progress } });
}

const yieldToEventLoop = () => new Promise<void>((resolve) => setImmediate(resolve));

/**
 * Executes a DOCUMENT job: claims it, generates the schema's related tables,
 * binds each header row to its line items, renders one multi-page PDF and
 * publishes it. Failures mark the job FAILED with the reason.
 */
export async function processDocumentJob(id: string, userId: string): Promise<GenerationJob> {
  const job = await prisma.generationJob.findUnique({
    where: { id },
    include: { workspace: { select: { userId: true } }, schema: true },
  });
  if (!job) throw new Error(`Generation job with id "${id}" not found.`);
  if (job.workspace.userId !== userId) {
    throw new Error(`Generation job "${id}" does not belong to the current user.`);
  }

  const claimed = await prisma.generationJob.updateMany({
    where: { id, status: { in: [JobStatus.QUEUED, JobStatus.PROCESSING] } },
    data: { status: JobStatus.PROCESSING, progress: 0 },
  });
  if (claimed.count === 0) return (await getJob(id)) as GenerationJob;

  try {
    const { schema } = job;
    if (schema.workspaceId !== job.workspaceId) {
      throw new DocumentEngineError("Schema does not belong to the job's workspace.");
    }

    const config = job.documentConfig as unknown as DocumentJobConfig | null;
    const layout = readDocumentLayout(config?.template?.layoutConfig) as PdfLayout | null;
    if (!config?.mapping || !layout) {
      throw new DocumentEngineError("The job has no valid document template configuration.");
    }
    const { mapping } = config;

    const tables = parseTables(schema.tables);
    const mappingErrors = validateDocumentMapping(mapping, layout, tables);
    if (mappingErrors.length) {
      throw new DocumentEngineError(`Template mapping no longer matches the schema: ${mappingErrors[0]}`);
    }
    const link = mapping.lineTable ? findLineLink(tables, mapping.headerTable, mapping.lineTable) : null;

    // ---- 1. Generate the related tables in dependency order (0–50%) ----
    const plan = planRelationalSchema(tableStructuresToRelationalInput(tables));
    const documentCount = Math.min(
      Math.max(Math.floor(job.rowCount ?? DOCUMENT_DEFAULT_COUNT), 1),
      DOCUMENT_MAX_COUNT
    );
    const baseSeed = job.seed ?? randomSeed();
    const locale = resolveFakerLocale(job.locale);
    const pools: KeyPools = new Map();
    let headerRows: GeneratedRow[] = [];
    let lineRows: GeneratedRow[] = [];

    for (const [position, table] of plan.tables.entries()) {
      const isHeader = table.name === mapping.headerTable;
      const generator = createRelationalTableGenerator(table, pools, tableSeed(baseSeed, table), {
        rowCount: documentCount,
        maxRows: isHeader ? documentCount : DOCUMENT_MAX_TABLE_ROWS,
        locale,
      });
      // Tables are small here; rows are only kept for the two the documents use
      const rows = generator.next(generator.rowCount);
      if (isHeader) headerRows = rows;
      else if (table.name === mapping.lineTable) lineRows = rows;

      await setProgress(id, Math.floor(((position + 1) / plan.tables.length) * 50));
      await yieldToEventLoop();
    }
    if (headerRows.length === 0) {
      throw new DocumentEngineError(`"${mapping.headerTable}" produced no rows to turn into documents.`);
    }

    // ---- 2. Bind line items to their header row (50–60%) ----
    const documents = buildDocumentModels({
      layout,
      mapping,
      headerRows,
      lineRows,
      link,
      seed: baseSeed,
    });
    await setProgress(id, 60);

    // ---- 3. Render the combined PDF (60–70%) and one PDF per document (70–90%) ----
    // The logo is fetched once (5 s timeout) and the fonts are PDF built-ins, so
    // rendering never waits on the network
    const logo = await fetchLogo(layout.branding.logoUrl);
    const renderInput = {
      title: `${config.template.name} — ${schema.name} v${schema.version}`,
      layout,
      documents,
      logo,
      keys: new Set(layout.mappingKeys),
    };
    const pdf = await renderDocumentPdf(renderInput);
    await setProgress(id, 70);

    let lastProgress = 70;
    const singles =
      documents.length > 1
        ? await renderEachDocumentPdf(renderInput, async (done) => {
            const progress = 70 + Math.floor((done / documents.length) * 20);
            if (progress !== lastProgress) {
              lastProgress = progress;
              await setProgress(id, progress);
            }
          })
        : [];
    await setProgress(id, 90);

    // ---- 4. Publish the PDF (+ ZIP of per-document PDFs) (90–100%) ----
    const { primary, files } = await publishDocumentExport(
      job.workspaceId,
      id,
      `${schema.name}_${layout.documentType}s`,
      pdf,
      singles.map((data, i) => ({ name: documentFileName(documents[i], i), data })),
      exportFormatToFile(job.exportFormat)
    );
    return await completeJob(id, primary.url, primary.sizeBytes, undefined, files.map((f) => f.format));
  } catch (error) {
    // Covers partial uploads and jobs deleted mid-run (completeJob → not found)
    await deleteJobExports(job.workspaceId, id).catch((cleanupError) => {
      console.error(`[documents] Failed to clean up exports for job ${id}:`, cleanupError);
    });

    const message = error instanceof Error ? error.message : String(error);
    return failJob(id, [
      {
        message,
        severity: "error",
        code:
          error instanceof TabularEngineError
            ? "GENERATION_ERROR"
            : error instanceof DocumentEngineError
              ? "DOCUMENT_ERROR"
              : error instanceof StorageError || error instanceof ExportError
                ? "EXPORT_ERROR"
                : "PDF_RENDER_ERROR",
        ...(error instanceof TabularEngineError && error.column && { field: error.column }),
      },
    ]);
  } finally {
    await removeJobStaging(id).catch(() => undefined);
  }
}

/** "invoice_INV-00012" / "statement_1234567890" for the entries of the ZIP. */
function documentFileName(doc: DocumentModel, index: number): string {
  const id = doc.kind === "invoice" ? doc.number : doc.accountNumber;
  return `${doc.kind}_${String(index + 1).padStart(3, "0")}_${id}`;
}
