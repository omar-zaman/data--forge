/**
 * React-PDF document definitions for DOCUMENT jobs.
 *
 * Pure presentation: the document engine hands over fully computed invoice /
 * statement models (totals, running balances, formatted dates) and this module
 * lays them out according to the VisualTemplate's branding, colours, typography
 * and layout style. One <Page> per document; long tables overflow onto extra
 * pages with the column header repeated.
 */

import type { ReactElement } from "react";
import type * as ReactPdf from "@react-pdf/renderer";
import {
  PDF_FONT_FAMILIES,
  type DocumentLayoutFields,
  type PdfFontFamily,
} from "@/lib/validations/document-template";

// @react-pdf/renderer is ESM-only (its sub-packages export only an "import"
// condition), while the worker runs as CommonJS under tsx. A native dynamic
// import() keeps it on Node's ESM loader; the components below read the
// primitives from this module once renderDocumentPdf has loaded it.
let pdf: typeof ReactPdf;
async function loadReactPdf(): Promise<typeof ReactPdf> {
  pdf ??= await import("@react-pdf/renderer");
  return pdf;
}

// ============================================
// Models
// ============================================

export interface InvoiceItem {
  description: string;
  quantity: number | null;
  unitPrice: number | null;
  amount: number;
}

export interface InvoiceModel {
  kind: "invoice";
  number: string;
  issueDate: string;
  dueDate: string | null;
  customer: { name: string; email: string | null; address: string | null };
  notes: string | null;
  items: InvoiceItem[];
  subtotal: number;
  tax: number | null;
  total: number;
}

export interface StatementTransaction {
  date: string;
  description: string;
  reference: string | null;
  amount: number;
  balance: number;
}

export interface StatementModel {
  kind: "statement";
  accountNumber: string;
  holder: string;
  address: string | null;
  statementDate: string;
  /** "Jan 3, 2024 – Mar 28, 2024" from the transaction dates. */
  period: string | null;
  openingBalance: number;
  closingBalance: number;
  totalCredits: number;
  totalDebits: number;
  transactions: StatementTransaction[];
}

export type DocumentModel = InvoiceModel | StatementModel;

export interface PdfLayout extends DocumentLayoutFields {
  pageSize?: "A4" | "LETTER" | "LEGAL";
  orientation?: "portrait" | "landscape";
  colors: { primary: string; secondary?: string; accent?: string; text?: string };
}

export interface PdfLogo {
  data: Buffer;
  format: "png" | "jpg";
}

export interface RenderPdfInput {
  title: string;
  layout: PdfLayout;
  documents: DocumentModel[];
  logo: PdfLogo | null;
  /** Which optional fields the template renders (layoutConfig.mappingKeys). */
  keys: Set<string>;
}

// ============================================
// Styles
// ============================================

function buildStyles(layout: PdfLayout) {
  const { colors, typography, layoutStyle } = layout;
  const primary = colors.primary;
  const muted = colors.secondary ?? "#6b7280";
  const accent = colors.accent ?? "#f3f4f6";
  const text = colors.text ?? "#111827";
  const base = typography.baseSize;
  const modern = layoutStyle === "modern";
  const classic = layoutStyle === "classic";

  return pdf.StyleSheet.create({
    page: {
      fontFamily: typography.fontFamily,
      fontSize: base,
      color: text,
      paddingTop: modern ? 0 : 40,
      paddingBottom: 56,
      paddingHorizontal: modern ? 0 : 40,
    },
    body: { paddingHorizontal: modern ? 40 : 0 },
    header: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "flex-start",
      marginBottom: 24,
      ...(modern && { backgroundColor: primary, color: "#ffffff", padding: 40, paddingBottom: 28 }),
      ...(classic && { borderBottomWidth: 2, borderBottomColor: primary, paddingBottom: 14 }),
    },
    brandRow: { flexDirection: "row", alignItems: "center", gap: 10 },
    logo: { width: 44, height: 44, objectFit: "contain" },
    company: { fontSize: base + 6, fontWeight: "bold", color: modern ? "#ffffff" : primary },
    companyMeta: { fontSize: base - 1, color: modern ? "#e5e7eb" : muted, marginTop: 3, maxWidth: 220 },
    title: {
      fontSize: base + 12,
      fontWeight: "bold",
      letterSpacing: 1.5,
      color: modern ? "#ffffff" : primary,
      textAlign: "right",
    },
    titleMeta: { fontSize: base - 1, color: modern ? "#e5e7eb" : muted, textAlign: "right", marginTop: 4 },
    infoRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 20, gap: 16 },
    infoBlock: { flexGrow: 1, flexBasis: 0 },
    label: {
      fontSize: base - 2,
      color: muted,
      textTransform: "uppercase",
      letterSpacing: 0.8,
      marginBottom: 3,
    },
    strong: { fontWeight: "bold" },
    metaLine: { flexDirection: "row", justifyContent: "flex-end", gap: 8, marginBottom: 2 },
    summaryBox: {
      flexDirection: "row",
      backgroundColor: accent,
      borderRadius: classic ? 0 : 4,
      padding: 12,
      marginBottom: 20,
      gap: 12,
      ...(classic && { borderWidth: 1, borderColor: primary }),
    },
    summaryCell: { flexGrow: 1, flexBasis: 0 },
    summaryValue: { fontSize: base + 2, fontWeight: "bold", color: primary },
    tableHead: {
      flexDirection: "row",
      paddingVertical: 6,
      paddingHorizontal: 6,
      ...(modern || layoutStyle === "minimal"
        ? { backgroundColor: modern ? primary : accent, color: modern ? "#ffffff" : text }
        : { borderTopWidth: 1, borderBottomWidth: 1, borderColor: primary }),
    },
    headCell: { fontSize: base - 1, fontWeight: "bold", textTransform: "uppercase" },
    row: {
      flexDirection: "row",
      paddingVertical: 5,
      paddingHorizontal: 6,
      borderBottomWidth: classic ? 0.5 : 0,
      borderBottomColor: "#d1d5db",
    },
    rowAlt: { backgroundColor: modern ? accent : "transparent" },
    cellGrow: { flexGrow: 1, flexBasis: 0, paddingRight: 6 },
    cellNarrow: { width: 60, textAlign: "right" },
    cellMoney: { width: 80, textAlign: "right" },
    cellRef: { width: 84, paddingRight: 6, fontSize: base - 1, color: muted },
    cellDate: { width: 70 },
    negative: { color: "#b91c1c" },
    totals: { marginTop: 12, marginLeft: "auto", width: 220 },
    totalLine: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 3 },
    grandTotal: {
      flexDirection: "row",
      justifyContent: "space-between",
      marginTop: 4,
      paddingTop: 6,
      paddingBottom: 6,
      paddingHorizontal: modern ? 8 : 0,
      borderTopWidth: modern ? 0 : 1.5,
      borderTopColor: primary,
      backgroundColor: modern ? primary : "transparent",
      color: modern ? "#ffffff" : primary,
      fontWeight: "bold",
      fontSize: base + 2,
    },
    notes: { marginTop: 24, padding: 10, borderLeftWidth: 3, borderLeftColor: primary, backgroundColor: accent },
    empty: { paddingVertical: 12, color: muted, textAlign: "center" },
    footer: {
      position: "absolute",
      bottom: 24,
      left: 40,
      right: 40,
      flexDirection: "row",
      justifyContent: "space-between",
      fontSize: base - 2,
      color: muted,
      borderTopWidth: 0.5,
      borderTopColor: "#d1d5db",
      paddingTop: 6,
    },
  });
}

type Styles = ReturnType<typeof buildStyles>;

// ============================================
// Formatting
// ============================================

function moneyFormatter(currency: string) {
  let format: Intl.NumberFormat;
  try {
    format = new Intl.NumberFormat("en-US", { style: "currency", currency });
  } catch {
    format = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  return (value: number) => format.format(value);
}

const quantityFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

/** References (often UUIDs) are clipped so they never spill into the amount column. */
function shortReference(ref: string | null): string {
  if (!ref) return "";
  return ref.length > 12 ? `${ref.slice(0, 11)}…` : ref;
}

// ============================================
// Shared pieces
// ============================================

interface SectionProps {
  s: Styles;
  layout: PdfLayout;
  logo: PdfLogo | null;
  keys: Set<string>;
  money: (value: number) => string;
}

function Brand({ s, layout, logo }: Pick<SectionProps, "s" | "layout" | "logo">) {
  const { Image, Text, View } = pdf;
  const { branding } = layout;
  return (
    <View style={s.brandRow}>
      {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image has no alt */}
      {logo && <Image style={s.logo} src={logo} />}
      <View>
        <Text style={s.company}>{branding.companyName}</Text>
        {branding.address ? <Text style={s.companyMeta}>{branding.address}</Text> : null}
      </View>
    </View>
  );
}

function Footer({ s, layout, label }: { s: Styles; layout: PdfLayout; label: string }) {
  const { Text, View } = pdf;
  return (
    <View style={s.footer} fixed>
      <Text>{layout.branding.footerText || layout.branding.companyName}</Text>
      <Text
        render={({ pageNumber, totalPages }) => `${label} · Page ${pageNumber} of ${totalPages}`}
      />
    </View>
  );
}

// ============================================
// Invoice
// ============================================

function InvoicePage({ doc, ...props }: SectionProps & { doc: InvoiceModel }) {
  const { Page, Text, View } = pdf;
  const { s, layout, keys, money } = props;
  const showQty = keys.has("item_quantity");
  const showPrice = keys.has("item_unit_price");

  return (
    <Page size={layout.pageSize ?? "A4"} orientation={layout.orientation ?? "portrait"} style={s.page}>
      <View style={s.header}>
        <Brand {...props} />
        <View>
          <Text style={s.title}>INVOICE</Text>
          <Text style={s.titleMeta}># {doc.number}</Text>
        </View>
      </View>

      <View style={s.body}>
        <View style={s.infoRow}>
          <View style={s.infoBlock}>
            <Text style={s.label}>Bill To</Text>
            <Text style={s.strong}>{doc.customer.name}</Text>
            {doc.customer.email ? <Text>{doc.customer.email}</Text> : null}
            {doc.customer.address ? <Text>{doc.customer.address}</Text> : null}
          </View>
          <View style={s.infoBlock}>
            <View style={s.metaLine}>
              <Text style={s.label}>Issue Date</Text>
              <Text>{doc.issueDate}</Text>
            </View>
            {doc.dueDate ? (
              <View style={s.metaLine}>
                <Text style={s.label}>Due Date</Text>
                <Text>{doc.dueDate}</Text>
              </View>
            ) : null}
            <View style={s.metaLine}>
              <Text style={s.label}>Amount Due</Text>
              <Text style={s.strong}>{money(doc.total)}</Text>
            </View>
          </View>
        </View>

        <View style={s.tableHead} fixed>
          <Text style={[s.headCell, s.cellGrow]}>Description</Text>
          {showQty && <Text style={[s.headCell, s.cellNarrow]}>Qty</Text>}
          {showPrice && <Text style={[s.headCell, s.cellMoney]}>Unit Price</Text>}
          <Text style={[s.headCell, s.cellMoney]}>Amount</Text>
        </View>
        {doc.items.length === 0 ? (
          <Text style={s.empty}>No line items</Text>
        ) : (
          doc.items.map((item, i) => (
            <View key={i} style={i % 2 === 1 ? [s.row, s.rowAlt] : s.row} wrap={false}>
              <Text style={s.cellGrow}>{item.description}</Text>
              {showQty && (
                <Text style={s.cellNarrow}>
                  {item.quantity === null ? "—" : quantityFormat.format(item.quantity)}
                </Text>
              )}
              {showPrice && (
                <Text style={s.cellMoney}>
                  {item.unitPrice === null ? "—" : money(item.unitPrice)}
                </Text>
              )}
              <Text style={s.cellMoney}>{money(item.amount)}</Text>
            </View>
          ))
        )}

        <View style={s.totals} wrap={false}>
          <View style={s.totalLine}>
            <Text>Subtotal</Text>
            <Text>{money(doc.subtotal)}</Text>
          </View>
          {doc.tax !== null ? (
            <View style={s.totalLine}>
              <Text>Tax</Text>
              <Text>{money(doc.tax)}</Text>
            </View>
          ) : null}
          <View style={s.grandTotal}>
            <Text>Total</Text>
            <Text>{money(doc.total)}</Text>
          </View>
        </View>

        {doc.notes ? (
          <View style={s.notes} wrap={false}>
            <Text style={s.label}>Notes</Text>
            <Text>{doc.notes}</Text>
          </View>
        ) : null}
      </View>

      <Footer s={s} layout={layout} label={`Invoice ${doc.number}`} />
    </Page>
  );
}

// ============================================
// Bank statement
// ============================================

function StatementPage({ doc, ...props }: SectionProps & { doc: StatementModel }) {
  const { Page, Text, View } = pdf;
  const { s, layout, keys, money } = props;
  const showRef = keys.has("txn_reference");

  return (
    <Page size={layout.pageSize ?? "A4"} orientation={layout.orientation ?? "portrait"} style={s.page}>
      <View style={s.header}>
        <Brand {...props} />
        <View>
          <Text style={s.title}>STATEMENT</Text>
          <Text style={s.titleMeta}>Account {doc.accountNumber}</Text>
          <Text style={s.titleMeta}>Statement date {doc.statementDate}</Text>
          {doc.period ? <Text style={s.titleMeta}>Period {doc.period}</Text> : null}
        </View>
      </View>

      <View style={s.body}>
        <View style={s.infoRow}>
          <View style={s.infoBlock}>
            <Text style={s.label}>Account Holder</Text>
            <Text style={s.strong}>{doc.holder}</Text>
            {doc.address ? <Text>{doc.address}</Text> : null}
          </View>
        </View>

        <View style={s.summaryBox}>
          {(
            [
              ["Opening Balance", doc.openingBalance],
              ["Money In", doc.totalCredits],
              ["Money Out", doc.totalDebits],
              ["Closing Balance", doc.closingBalance],
            ] as const
          ).map(([label, value]) => (
            <View key={label} style={s.summaryCell}>
              <Text style={s.label}>{label}</Text>
              <Text style={s.summaryValue}>{money(value)}</Text>
            </View>
          ))}
        </View>

        <View style={s.tableHead} fixed>
          <Text style={[s.headCell, s.cellDate]}>Date</Text>
          <Text style={[s.headCell, s.cellGrow]}>Description</Text>
          {showRef && <Text style={[s.headCell, s.cellRef]}>Reference</Text>}
          <Text style={[s.headCell, s.cellMoney]}>Amount</Text>
          <Text style={[s.headCell, s.cellMoney]}>Balance</Text>
        </View>
        {doc.transactions.length === 0 ? (
          <Text style={s.empty}>No transactions in this period</Text>
        ) : (
          doc.transactions.map((txn, i) => (
            <View key={i} style={i % 2 === 1 ? [s.row, s.rowAlt] : s.row} wrap={false}>
              <Text style={s.cellDate}>{txn.date}</Text>
              <Text style={s.cellGrow}>{txn.description}</Text>
              {showRef && <Text style={s.cellRef}>{shortReference(txn.reference)}</Text>}
              <Text style={txn.amount < 0 ? [s.cellMoney, s.negative] : s.cellMoney}>
                {money(txn.amount)}
              </Text>
              <Text style={s.cellMoney}>{money(txn.balance)}</Text>
            </View>
          ))
        )}
      </View>

      <Footer s={s} layout={layout} label={`Account ${doc.accountNumber}`} />
    </Page>
  );
}

// ============================================
// Rendering
// ============================================

function DocumentSet({ title, layout, documents, logo, keys }: RenderPdfInput) {
  const { Document } = pdf;
  const s = buildStyles(layout);
  const money = moneyFormatter(layout.currency);
  const props = { s, layout, logo, keys, money };

  return (
    <Document title={title} author={layout.branding.companyName} creator="DataForge" producer="DataForge">
      {documents.map((doc, i) =>
        doc.kind === "invoice" ? (
          <InvoicePage key={i} doc={doc} {...props} />
        ) : (
          <StatementPage key={i} doc={doc} {...props} />
        )
      )}
    </Document>
  );
}

async function renderToBuffer(element: ReactElement<ReactPdf.DocumentProps>): Promise<Buffer> {
  const { renderToStream } = await loadReactPdf();
  const stream = await renderToStream(element);
  const chunks: Buffer[] = [];
  for await (const chunk of stream as AsyncIterable<Buffer | string>) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

/** Renders every document into one PDF, collecting the React-PDF stream into a buffer. */
export async function renderDocumentPdf(input: RenderPdfInput): Promise<Buffer> {
  await loadReactPdf();
  return renderToBuffer(<DocumentSet {...input} />);
}

/**
 * Renders each document into its own PDF (for the per-document ZIP). Yields
 * between documents so the worker keeps renewing its queue lock.
 */
export async function renderEachDocumentPdf(
  input: RenderPdfInput,
  onProgress?: (done: number) => Promise<void> | void
): Promise<Buffer[]> {
  await loadReactPdf();
  const buffers: Buffer[] = [];
  for (const doc of input.documents) {
    buffers.push(await renderToBuffer(<DocumentSet {...input} documents={[doc]} />));
    await onProgress?.(buffers.length);
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  return buffers;
}

// ============================================
// Dataset report (data jobs exported as PDF)
// ============================================

export type ReportCell = string | number | boolean | null | undefined;

export interface ReportTable {
  name: string;
  columns: string[];
  /** Printed rows (a leading sample of the generated table). */
  rows: ReportCell[][];
  /** Rows generated for the table (may exceed rows.length). */
  totalRows: number;
}

/** Visual styling of the dataset report, resolved from a VisualTemplate's layoutConfig. */
export interface ReportTheme {
  primary: string;
  /** Text colour on primary-filled areas (the table header). */
  onPrimary: string;
  muted: string;
  text: string;
  rowAlt: string;
  fontFamily: PdfFontFamily;
  baseSize: number;
  pageSize: "A4" | "LETTER" | "LEGAL";
  orientation: "portrait" | "landscape";
  /** Shown in the footer (template branding.companyName / footerText). */
  brand: string | null;
}

/** Standard black-and-white table layout, used when a job has no (valid) template. */
export const DEFAULT_REPORT_THEME: ReportTheme = {
  primary: "#000000",
  onPrimary: "#ffffff",
  muted: "#555555",
  text: "#000000",
  rowAlt: "#f2f2f2",
  fontFamily: "Helvetica",
  baseSize: 7.5,
  pageSize: "A4",
  orientation: "landscape",
  brand: null,
};

const HEX_COLOR = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readColor(value: unknown): string | undefined {
  return typeof value === "string" && HEX_COLOR.test(value) ? value : undefined;
}

function readFont(value: unknown): PdfFontFamily | undefined {
  return (PDF_FONT_FAMILIES as readonly unknown[]).includes(value) ? (value as PdfFontFamily) : undefined;
}

/**
 * Maps a template's layoutConfig (document templates' colors / typography /
 * branding, or generic colors / fonts) onto the report theme. Anything missing
 * or malformed falls back to DEFAULT_REPORT_THEME, so this never throws.
 */
export function resolveReportTheme(layoutConfig: unknown): ReportTheme {
  const config = asRecord(layoutConfig);
  const colors = asRecord(config.colors);
  const typography = asRecord(config.typography);
  const branding = asRecord(config.branding);
  const firstFont = asRecord(Array.isArray(config.fonts) ? config.fonts[0] : undefined);

  const rawSize = typeof typography.baseSize === "number" ? typography.baseSize : firstFont.size;
  // Report cells are dense: scale document body sizes (8–14pt) into a 6–11pt range
  const baseSize =
    typeof rawSize === "number" && Number.isFinite(rawSize)
      ? Math.min(11, Math.max(6, rawSize * 0.8))
      : DEFAULT_REPORT_THEME.baseSize;
  const pageSize = ["A4", "LETTER", "LEGAL"].includes(config.pageSize as string)
    ? (config.pageSize as ReportTheme["pageSize"])
    : DEFAULT_REPORT_THEME.pageSize;
  const orientation = config.orientation === "portrait" ? "portrait" : DEFAULT_REPORT_THEME.orientation;
  const brandText = [branding.footerText, branding.companyName].find(
    (v): v is string => typeof v === "string" && v.trim() !== ""
  );

  return {
    primary: readColor(colors.primary) ?? DEFAULT_REPORT_THEME.primary,
    onPrimary: DEFAULT_REPORT_THEME.onPrimary,
    muted: readColor(colors.secondary) ?? DEFAULT_REPORT_THEME.muted,
    text: readColor(colors.text) ?? DEFAULT_REPORT_THEME.text,
    rowAlt: readColor(colors.accent) ?? DEFAULT_REPORT_THEME.rowAlt,
    fontFamily: readFont(typography.fontFamily) ?? readFont(firstFont.family) ?? DEFAULT_REPORT_THEME.fontFamily,
    baseSize,
    pageSize,
    orientation,
    brand: brandText?.trim() ?? null,
  };
}

export interface RenderReportInput {
  title: string;
  subtitle?: string;
  tables: ReportTable[];
  /** Omitted → DEFAULT_REPORT_THEME. */
  theme?: ReportTheme;
}

/** Columns printed per table; wider tables list the omitted columns in a note. */
export const REPORT_MAX_COLUMNS = 10;
const REPORT_CELL_MAX_CHARS = 48;

const reportStyles = (t: ReportTheme) =>
  pdf.StyleSheet.create({
    page: { fontFamily: t.fontFamily, fontSize: t.baseSize, color: t.text, padding: 32, paddingBottom: 48 },
    cover: { marginBottom: 14, paddingBottom: 10, borderBottomWidth: 2, borderBottomColor: t.primary },
    title: { fontSize: t.baseSize + 10.5, fontWeight: "bold", color: t.primary },
    subtitle: { fontSize: t.baseSize + 1.5, color: t.muted, marginTop: 4 },
    tableTitle: { fontSize: t.baseSize + 4.5, fontWeight: "bold", marginBottom: 2 },
    tableMeta: { fontSize: t.baseSize + 0.5, color: t.muted, marginBottom: 8 },
    head: { flexDirection: "row", backgroundColor: t.primary, color: t.onPrimary, paddingVertical: 4 },
    headCell: { flexGrow: 1, flexBasis: 0, paddingHorizontal: 3, fontWeight: "bold" },
    row: { flexDirection: "row", paddingVertical: 3, borderBottomWidth: 0.5, borderBottomColor: "#d9d9d9" },
    rowAlt: { backgroundColor: t.rowAlt },
    cell: { flexGrow: 1, flexBasis: 0, paddingHorizontal: 3 },
    numeric: { textAlign: "right" },
    note: { marginTop: 6, fontSize: t.baseSize - 0.5, color: t.muted },
    footer: {
      position: "absolute",
      bottom: 20,
      left: 32,
      right: 32,
      flexDirection: "row",
      justifyContent: "space-between",
      fontSize: t.baseSize - 0.5,
      color: t.muted,
    },
  });

function formatReportCell(value: ReportCell): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "true" : "false";
  const text = String(value);
  return text.length > REPORT_CELL_MAX_CHARS ? `${text.slice(0, REPORT_CELL_MAX_CHARS - 1)}…` : text;
}

function DatasetReport({ title, subtitle, tables, theme = DEFAULT_REPORT_THEME }: RenderReportInput) {
  const { Document, Page, Text, View } = pdf;
  const s = reportStyles(theme);
  const countFormat = new Intl.NumberFormat("en-US");

  return (
    <Document title={title} creator="DataForge" producer="DataForge">
      {tables.map((table, t) => {
        const columns = table.columns.slice(0, REPORT_MAX_COLUMNS);
        const omitted = table.columns.slice(REPORT_MAX_COLUMNS);
        // Right-align columns whose printed values are all numeric
        const numeric = columns.map((_, c) =>
          table.rows.length > 0 && table.rows.every((r) => r[c] === null || r[c] === undefined || typeof r[c] === "number")
        );
        return (
          <Page key={t} size={theme.pageSize} orientation={theme.orientation} style={s.page}>
            {t === 0 && (
              <View style={s.cover}>
                <Text style={s.title}>{title}</Text>
                {subtitle ? <Text style={s.subtitle}>{subtitle}</Text> : null}
              </View>
            )}
            <Text style={s.tableTitle}>{table.name}</Text>
            <Text style={s.tableMeta}>
              {table.rows.length < table.totalRows
                ? `Showing the first ${countFormat.format(table.rows.length)} of ${countFormat.format(table.totalRows)} rows — the full table is in the CSV / JSON / SQL exports.`
                : `${countFormat.format(table.totalRows)} rows`}
            </Text>
            <View style={s.head} fixed>
              {columns.map((c, i) => (
                <Text key={i} style={numeric[i] ? [s.headCell, s.numeric] : s.headCell}>
                  {c}
                </Text>
              ))}
            </View>
            {table.rows.map((row, r) => (
              <View key={r} style={r % 2 === 1 ? [s.row, s.rowAlt] : s.row} wrap={false}>
                {columns.map((_, c) => (
                  <Text key={c} style={numeric[c] ? [s.cell, s.numeric] : s.cell}>
                    {formatReportCell(row[c])}
                  </Text>
                ))}
              </View>
            ))}
            {omitted.length > 0 && (
              <Text style={s.note}>
                {omitted.length} more column{omitted.length === 1 ? "" : "s"} not shown: {omitted.join(", ")}
              </Text>
            )}
            <View style={s.footer} fixed>
              <Text>{theme.brand ?? "DataForge"} · {title}</Text>
              <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
            </View>
          </Page>
        );
      })}
    </Document>
  );
}

/** Renders generated tables as a paginated, landscape PDF report. */
export async function renderDatasetReportPdf(input: RenderReportInput): Promise<Buffer> {
  await loadReactPdf();
  return renderToBuffer(<DatasetReport {...input} />);
}
