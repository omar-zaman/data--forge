/**
 * React-PDF document definitions for DOCUMENT jobs.
 *
 * Pure presentation: the document engine hands over fully computed invoice /
 * statement models (totals, running balances, formatted dates) and this module
 * lays them out according to the VisualTemplate's branding, colours, typography
 * and layout style. One <Page> per document; long tables overflow onto extra
 * pages with the column header repeated.
 */

import type * as ReactPdf from "@react-pdf/renderer";
import type { DocumentLayoutFields } from "@/lib/validations/document-template";

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

/** Renders every document into one PDF, collecting the React-PDF stream into a buffer. */
export async function renderDocumentPdf(input: RenderPdfInput): Promise<Buffer> {
  const { renderToStream } = await loadReactPdf();
  const stream = await renderToStream(<DocumentSet {...input} />);
  const chunks: Buffer[] = [];
  for await (const chunk of stream as AsyncIterable<Buffer | string>) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}
