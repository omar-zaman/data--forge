/**
 * Document template contract shared by the template gallery, the Documents tab,
 * the jobs API and the PDF worker.
 *
 * A document VisualTemplate's layoutConfig declares its `documentType` and the
 * exact `mappingKeys` it renders. Each key is filled from a column of the
 * schema's header table (one document per row) or its line-item table (child
 * rows linked to the header row by a foreign key).
 */

import type { TableStructure } from "@/types/database";

/** One PDF page (or more) per header row; rendering is CPU-bound, so keep it bounded. */
export const DOCUMENT_MAX_COUNT = 500;
export const DOCUMENT_DEFAULT_COUNT = 25;

// ============================================
// Document types & mapping keys
// ============================================

export const DOCUMENT_TYPES = ["invoice", "statement"] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export type MappingScope = "header" | "line";

export interface MappingKeySpec {
  key: string;
  label: string;
  scope: MappingScope;
  /** Required keys are always part of the template and must be mapped. */
  required: boolean;
  /** Column-name fragments used to suggest a mapping. */
  hints: string[];
  /** How the PDF formats the value. */
  format: "text" | "date" | "money" | "number";
}

export const DOCUMENT_MAPPING_KEYS: Record<DocumentType, MappingKeySpec[]> = {
  invoice: [
    { key: "invoice_number", label: "Invoice Number", scope: "header", required: true, hints: ["invoice_number", "invoice_no", "number", "order_number", "id"], format: "text" },
    { key: "issue_date", label: "Issue Date", scope: "header", required: true, hints: ["issue_date", "invoice_date", "order_date", "created", "date"], format: "date" },
    { key: "due_date", label: "Due Date", scope: "header", required: false, hints: ["due_date", "due", "ship_date"], format: "date" },
    { key: "customer_name", label: "Bill To (Name)", scope: "header", required: true, hints: ["customer_name", "client_name", "name", "company", "customer"], format: "text" },
    { key: "customer_email", label: "Bill To (Email)", scope: "header", required: false, hints: ["email"], format: "text" },
    { key: "customer_address", label: "Bill To (Address)", scope: "header", required: false, hints: ["address", "street", "city"], format: "text" },
    { key: "tax_amount", label: "Tax", scope: "header", required: false, hints: ["tax", "vat"], format: "money" },
    { key: "total_amount", label: "Invoice Total", scope: "header", required: false, hints: ["total_amount", "total", "grand_total", "amount"], format: "money" },
    { key: "notes", label: "Notes", scope: "header", required: false, hints: ["notes", "note", "memo", "comment", "description"], format: "text" },
    { key: "item_description", label: "Item Description", scope: "line", required: true, hints: ["description", "product", "item", "name", "title"], format: "text" },
    { key: "item_quantity", label: "Quantity", scope: "line", required: false, hints: ["quantity", "qty", "units", "count"], format: "number" },
    { key: "item_unit_price", label: "Unit Price", scope: "line", required: false, hints: ["unit_price", "price", "rate", "cost"], format: "money" },
    { key: "item_amount", label: "Line Amount", scope: "line", required: false, hints: ["line_total", "subtotal", "amount", "total"], format: "money" },
  ],
  statement: [
    { key: "account_number", label: "Account Number", scope: "header", required: true, hints: ["account_number", "account_no", "iban", "number", "id"], format: "text" },
    { key: "account_holder", label: "Account Holder", scope: "header", required: true, hints: ["account_holder", "holder", "customer_name", "name", "owner"], format: "text" },
    { key: "holder_address", label: "Holder Address", scope: "header", required: false, hints: ["address", "street", "city"], format: "text" },
    { key: "statement_date", label: "Statement Date", scope: "header", required: true, hints: ["statement_date", "period_end", "opened", "created", "date"], format: "date" },
    { key: "opening_balance", label: "Opening Balance", scope: "header", required: false, hints: ["opening_balance", "opening", "starting_balance", "balance"], format: "money" },
    { key: "txn_date", label: "Transaction Date", scope: "line", required: true, hints: ["transaction_date", "txn_date", "posted", "date"], format: "date" },
    { key: "txn_description", label: "Transaction Description", scope: "line", required: true, hints: ["description", "merchant", "memo", "payee", "name"], format: "text" },
    { key: "txn_reference", label: "Reference", scope: "line", required: false, hints: ["reference", "ref", "transaction_id", "id"], format: "text" },
    { key: "txn_amount", label: "Amount", scope: "line", required: true, hints: ["amount", "value", "total"], format: "money" },
  ],
};

export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  invoice: "Invoice",
  statement: "Bank Statement",
};

export function getMappingKeySpecs(type: DocumentType, keys?: string[]): MappingKeySpec[] {
  const specs = DOCUMENT_MAPPING_KEYS[type];
  if (!keys) return specs;
  const enabled = new Set(keys);
  return specs.filter((s) => enabled.has(s.key));
}

// ============================================
// Document layoutConfig
// ============================================

export const PDF_FONT_FAMILIES = ["Helvetica", "Times-Roman", "Courier"] as const;
export type PdfFontFamily = (typeof PDF_FONT_FAMILIES)[number];

export const DOCUMENT_LAYOUT_STYLES = ["classic", "modern", "minimal"] as const;
export type DocumentLayoutStyle = (typeof DOCUMENT_LAYOUT_STYLES)[number];

export interface DocumentBranding {
  companyName: string;
  logoUrl?: string;
  address?: string;
  footerText?: string;
}

export interface DocumentTypography {
  fontFamily: PdfFontFamily;
  baseSize: number; // pt, 8–14
}

export const CURRENCIES = ["USD", "EUR", "GBP", "PKR", "INR", "JPY", "AUD", "CAD"] as const;

/** layoutConfig keys that make a VisualTemplate renderable as a PDF document. */
export interface DocumentLayoutFields {
  documentType: DocumentType;
  mappingKeys: string[];
  layoutStyle: DocumentLayoutStyle;
  currency: string;
  branding: DocumentBranding;
  typography: DocumentTypography;
}

const HEX_COLOR_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export function isDocumentType(value: unknown): value is DocumentType {
  return typeof value === "string" && (DOCUMENT_TYPES as readonly string[]).includes(value);
}

/** Every key of the type with required keys guaranteed to be present, in canonical order. */
export function normalizeMappingKeys(type: DocumentType, keys: string[]): string[] {
  const wanted = new Set(keys);
  return DOCUMENT_MAPPING_KEYS[type]
    .filter((s) => s.required || wanted.has(s.key))
    .map((s) => s.key);
}

/**
 * Strictly validates the document fields of a layoutConfig (called when
 * `documentType` is present). Unknown keys inside the document objects and
 * mapping keys the type doesn't define are rejected.
 */
export function validateDocumentLayoutFields(config: Record<string, unknown>): string[] {
  const errors: string[] = [];
  const type = config.documentType;
  if (!isDocumentType(type)) {
    return [`documentType must be one of: ${DOCUMENT_TYPES.join(", ")}`];
  }

  const specs = DOCUMENT_MAPPING_KEYS[type];
  const known = new Set(specs.map((s) => s.key));
  const keys = config.mappingKeys;
  if (!Array.isArray(keys) || !keys.every((k) => typeof k === "string")) {
    errors.push("mappingKeys must be an array of strings");
  } else {
    const unknown = keys.filter((k) => !known.has(k));
    if (unknown.length) {
      errors.push(`mappingKeys contains keys not defined for ${type}: ${unknown.join(", ")}`);
    }
    if (new Set(keys).size !== keys.length) errors.push("mappingKeys must not repeat keys");
    const missing = specs.filter((s) => s.required && !keys.includes(s.key));
    if (missing.length) {
      errors.push(`mappingKeys must include the required keys: ${missing.map((s) => s.key).join(", ")}`);
    }
  }

  if (!(DOCUMENT_LAYOUT_STYLES as readonly unknown[]).includes(config.layoutStyle)) {
    errors.push(`layoutStyle must be one of: ${DOCUMENT_LAYOUT_STYLES.join(", ")}`);
  }
  if (!(CURRENCIES as readonly unknown[]).includes(config.currency)) {
    errors.push(`currency must be one of: ${CURRENCIES.join(", ")}`);
  }

  const branding = config.branding as Record<string, unknown> | undefined;
  if (!branding || typeof branding !== "object" || Array.isArray(branding)) {
    errors.push("branding must be an object");
  } else {
    const allowed = ["companyName", "logoUrl", "address", "footerText"];
    const extra = Object.keys(branding).filter((k) => !allowed.includes(k));
    if (extra.length) errors.push(`branding has unknown keys: ${extra.join(", ")}`);
    if (typeof branding.companyName !== "string" || !branding.companyName.trim()) {
      errors.push("branding.companyName must be a non-empty string");
    } else if (branding.companyName.length > 80) {
      errors.push("branding.companyName must be at most 80 characters");
    }
    if (branding.logoUrl !== undefined && branding.logoUrl !== "") {
      if (typeof branding.logoUrl !== "string" || !isHttpsUrl(branding.logoUrl)) {
        errors.push("branding.logoUrl must be an https:// URL");
      }
    }
    for (const field of ["address", "footerText"] as const) {
      const value = branding[field];
      if (value !== undefined && (typeof value !== "string" || value.length > 300)) {
        errors.push(`branding.${field} must be a string of at most 300 characters`);
      }
    }
  }

  const typography = config.typography as Record<string, unknown> | undefined;
  if (!typography || typeof typography !== "object" || Array.isArray(typography)) {
    errors.push("typography must be an object");
  } else {
    const extra = Object.keys(typography).filter((k) => k !== "fontFamily" && k !== "baseSize");
    if (extra.length) errors.push(`typography has unknown keys: ${extra.join(", ")}`);
    if (!(PDF_FONT_FAMILIES as readonly unknown[]).includes(typography.fontFamily)) {
      errors.push(`typography.fontFamily must be one of: ${PDF_FONT_FAMILIES.join(", ")}`);
    }
    const size = typography.baseSize;
    if (typeof size !== "number" || !Number.isFinite(size) || size < 8 || size > 14) {
      errors.push("typography.baseSize must be a number between 8 and 14");
    }
  }

  const colors = config.colors as Record<string, unknown> | undefined;
  if (!colors || typeof colors.primary !== "string" || !HEX_COLOR_RE.test(colors.primary)) {
    errors.push("colors.primary must be a hex color for document templates");
  }

  return errors;
}

export function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

/** Reads the document fields of a stored layoutConfig, or null if it isn't a valid document template. */
export function readDocumentLayout(
  raw: unknown
): (DocumentLayoutFields & { colors: { primary: string; secondary?: string; accent?: string; text?: string } }) | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const config = raw as Record<string, unknown>;
  if (validateDocumentLayoutFields(config).length > 0) return null;
  return config as unknown as DocumentLayoutFields & {
    colors: { primary: string; secondary?: string; accent?: string; text?: string };
  };
}

// ============================================
// Presets (gallery starting points)
// ============================================

export interface DocumentTemplatePreset {
  id: string;
  name: string;
  description: string;
  category: DocumentType;
  layoutConfig: DocumentLayoutFields & {
    pageSize: "A4" | "LETTER";
    orientation: "portrait";
    colors: { primary: string; secondary: string; accent: string; text: string };
  };
}

export const DOCUMENT_TEMPLATE_PRESETS: DocumentTemplatePreset[] = [
  {
    id: "classic-invoice",
    name: "Classic Invoice",
    description: "Serif type, bordered header band and a ruled line-item table.",
    category: "invoice",
    layoutConfig: {
      documentType: "invoice",
      mappingKeys: normalizeMappingKeys("invoice", DOCUMENT_MAPPING_KEYS.invoice.map((s) => s.key)),
      layoutStyle: "classic",
      currency: "USD",
      pageSize: "A4",
      orientation: "portrait",
      branding: { companyName: "Northwind Supplies", address: "210 Market Street, Springfield", footerText: "Thank you for your business." },
      typography: { fontFamily: "Times-Roman", baseSize: 10 },
      colors: { primary: "#1e3a5f", secondary: "#64748b", accent: "#e2e8f0", text: "#0f172a" },
    },
  },
  {
    id: "modern-invoice",
    name: "Modern Invoice",
    description: "Full-bleed colour header, sans-serif type and zebra-striped items.",
    category: "invoice",
    layoutConfig: {
      documentType: "invoice",
      mappingKeys: normalizeMappingKeys("invoice", ["due_date", "customer_email", "customer_address", "tax_amount", "total_amount", "item_quantity", "item_unit_price", "item_amount"]),
      layoutStyle: "modern",
      currency: "USD",
      pageSize: "A4",
      orientation: "portrait",
      branding: { companyName: "Acme Studio", address: "42 Harbour Road, Bristol", footerText: "Payment due within 30 days." },
      typography: { fontFamily: "Helvetica", baseSize: 10 },
      colors: { primary: "#4f46e5", secondary: "#6b7280", accent: "#eef2ff", text: "#111827" },
    },
  },
  {
    id: "bank-statement",
    name: "Bank Statement",
    description: "Account summary box with a running-balance transaction ledger.",
    category: "statement",
    layoutConfig: {
      documentType: "statement",
      mappingKeys: normalizeMappingKeys("statement", DOCUMENT_MAPPING_KEYS.statement.map((s) => s.key)),
      layoutStyle: "minimal",
      currency: "USD",
      pageSize: "LETTER",
      orientation: "portrait",
      branding: { companyName: "First Harbor Bank", address: "1 Finance Plaza, New York, NY", footerText: "Member FDIC. Report discrepancies within 60 days." },
      typography: { fontFamily: "Helvetica", baseSize: 9 },
      colors: { primary: "#047857", secondary: "#6b7280", accent: "#ecfdf5", text: "#111827" },
    },
  },
];

// ============================================
// Schema → template mapping (stored on the job)
// ============================================

export interface DocumentMapping {
  headerTable: string;
  /** Child table whose rows become line items; required when any line key is mapped. */
  lineTable?: string;
  /** mapping key → column name (header keys → headerTable, line keys → lineTable). */
  fields: Record<string, string>;
}

/** Snapshot persisted on GenerationJob.documentConfig when a document job is created. */
export interface DocumentJobConfig {
  template: { id: string; name: string; layoutConfig: Record<string, unknown> };
  mapping: DocumentMapping;
}

/** Foreign keys of `lineTable` that point at `headerTable`. */
export function findLineLink(
  tables: TableStructure[],
  headerTable: string,
  lineTable: string
): { fromColumn: string; toColumn: string } | null {
  const table = tables.find((t) => t.name === lineTable);
  const fk = table?.foreignKeys?.find((f) => f.toTable === headerTable);
  return fk ? { fromColumn: fk.fromColumn, toColumn: fk.toColumn } : null;
}

/** Tables that reference `headerTable` with a foreign key (line-item candidates). */
export function lineTableCandidates(tables: TableStructure[], headerTable: string): string[] {
  return tables
    .filter((t) => t.name !== headerTable && t.foreignKeys?.some((f) => f.toTable === headerTable))
    .map((t) => t.name);
}

/** Validates a mapping against the template's mapping keys and the schema's tables. */
export function validateDocumentMapping(
  mapping: DocumentMapping,
  layout: DocumentLayoutFields,
  tables: TableStructure[]
): string[] {
  const errors: string[] = [];
  const header = tables.find((t) => t.name === mapping.headerTable);
  if (!header) return [`Header table "${mapping.headerTable}" does not exist in the schema`];

  const specs = getMappingKeySpecs(layout.documentType, layout.mappingKeys);
  const needsLines = specs.some((s) => s.scope === "line");
  let line: TableStructure | undefined;
  if (needsLines) {
    if (!mapping.lineTable) {
      errors.push("Select a line-item table that references the header table");
    } else {
      line = tables.find((t) => t.name === mapping.lineTable);
      if (!line) errors.push(`Line-item table "${mapping.lineTable}" does not exist in the schema`);
      else if (!findLineLink(tables, header.name, line.name)) {
        errors.push(`"${line.name}" has no foreign key to "${header.name}"`);
      }
    }
  }

  const specByKey = new Map(specs.map((s) => [s.key, s]));
  for (const [key, column] of Object.entries(mapping.fields ?? {})) {
    const spec = specByKey.get(key);
    if (!spec) {
      errors.push(`"${key}" is not a mapping key of this template`);
      continue;
    }
    if (!column) continue;
    const table = spec.scope === "header" ? header : line;
    if (table && !table.columns.some((c) => c.name === column)) {
      errors.push(`${spec.label}: column "${column}" does not exist in "${table.name}"`);
    }
  }
  for (const spec of specs) {
    if (spec.required && !mapping.fields?.[spec.key]) {
      errors.push(`${spec.label} must be mapped to a column`);
    }
  }
  return errors;
}

/** Suggests a column for every mapping key from the column names. */
export function suggestMapping(
  specs: MappingKeySpec[],
  headerColumns: string[],
  lineColumns: string[]
): Record<string, string> {
  const result: Record<string, string> = {};
  const used = { header: new Set<string>(), line: new Set<string>() };

  for (const spec of specs) {
    const columns = spec.scope === "header" ? headerColumns : lineColumns;
    const taken = used[spec.scope];
    const normalized = columns.map((c) => ({ c, n: c.toLowerCase().replace(/[^a-z0-9]+/g, "_") }));
    let match: string | undefined;
    for (const hint of spec.hints) {
      match =
        normalized.find(({ c, n }) => !taken.has(c) && n === hint)?.c ??
        normalized.find(({ c, n }) => !taken.has(c) && n.includes(hint))?.c;
      if (match) break;
    }
    if (match) {
      result[spec.key] = match;
      taken.add(match);
    }
  }
  return result;
}
