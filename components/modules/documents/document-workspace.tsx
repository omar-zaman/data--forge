"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowRight, CheckCircle2, FileText, LayoutTemplate, Loader2, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { groupSchemas, type SchemaSummary } from "@/components/modules/schema/schema-picker";
import { TemplateThumbnail, type TemplateSummary } from "@/components/modules/templates/template-gallery";
import JobHistoryTable, { useWorkspaceJobs, type JobRow } from "@/components/modules/jobs/job-history-table";
import {
  DOCUMENT_DEFAULT_COUNT,
  DOCUMENT_MAX_COUNT,
  DOCUMENT_TYPE_LABELS,
  getMappingKeySpecs,
  lineTableCandidates,
  readDocumentLayout,
  suggestMapping,
  validateDocumentMapping,
  type MappingKeySpec,
} from "@/lib/validations/document-template";

/** What the PDF shows when an optional key is left unmapped. */
const UNMAPPED_BEHAVIOUR: Record<string, string> = {
  total_amount: "computed from line items + tax",
  item_amount: "computed as quantity × unit price",
  opening_balance: "seeded random balance",
};

const NONE = "__none__";

interface DocumentWorkspaceProps {
  workspaceId: string;
  initialSchemas: SchemaSummary[];
  templates: TemplateSummary[];
}

function StepHeading({ step, title, children }: { step: number; title: string; children?: React.ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <h3 className="flex items-center gap-2 font-semibold">
        <span className="flex size-6 items-center justify-center rounded-full bg-[var(--color-primary)] text-xs text-[var(--color-primary-foreground)]">
          {step}
        </span>
        {title}
      </h3>
      {children}
    </div>
  );
}

function MappingRow({
  spec,
  table,
  columns,
  value,
  onChange,
}: {
  spec: MappingKeySpec;
  table: string;
  columns: { name: string; type: string }[];
  value: string;
  onChange: (column: string) => void;
}) {
  const mapped = value !== "";
  return (
    <div
      className={cn(
        "grid items-center gap-2 rounded-md border px-3 py-2 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]",
        spec.required && !mapped
          ? "border-[var(--color-destructive)]"
          : "border-[var(--color-border)]"
      )}
    >
      <Select value={value || NONE} onValueChange={(v) => onChange(v === NONE ? "" : v)}>
        <SelectTrigger aria-label={`Column for ${spec.label}`} className="font-mono text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {!spec.required && <SelectItem value={NONE}>— not mapped —</SelectItem>}
          {spec.required && !mapped && <SelectItem value={NONE}>Select a column…</SelectItem>}
          {columns.map((c) => (
            <SelectItem key={c.name} value={c.name}>
              {table}.{c.name} <span className="text-[var(--color-muted-foreground)]">({c.type})</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <ArrowRight className="hidden size-4 text-[var(--color-muted-foreground)] sm:block" />
      <div className="flex min-w-0 items-center justify-between gap-2">
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium">{spec.label}</span>
          <span className="block truncate text-[11px] text-[var(--color-muted-foreground)]">
            {mapped
              ? `Map ${table}.${value} to ${spec.label}`
              : spec.required
                ? "Required"
                : UNMAPPED_BEHAVIOUR[spec.key] ?? "left out of the PDF"}
          </span>
        </span>
        {spec.required ? (
          <Badge variant={mapped ? "muted" : "destructive"} className="shrink-0">Required</Badge>
        ) : mapped ? (
          <CheckCircle2 className="size-4 shrink-0 text-green-600" />
        ) : null}
      </div>
    </div>
  );
}

/**
 * Documents tab: pick a relational schema and a visual template, map the
 * template's fields to schema columns, and queue a job that renders one
 * invoice / statement per header-table row into a single PDF.
 */
export default function DocumentWorkspace({ workspaceId, initialSchemas, templates }: DocumentWorkspaceProps) {
  const groups = useMemo(() => groupSchemas(initialSchemas), [initialSchemas]);
  const documentTemplates = useMemo(
    () => templates.filter((t) => readDocumentLayout(t.layoutConfig) !== null),
    [templates]
  );

  const [schemaId, setSchemaId] = useState<string | null>(groups[0]?.versions[0]?.id ?? null);
  const [templateId, setTemplateId] = useState<string | null>(documentTemplates[0]?.id ?? null);
  const schema = initialSchemas.find((s) => s.id === schemaId) ?? null;
  const template = documentTemplates.find((t) => t.id === templateId) ?? null;
  const layout = template ? readDocumentLayout(template.layoutConfig) : null;
  const tables = schema?.tables ?? [];

  // Table choice is remembered per schema; defaults prefer a table that has children
  const [tableChoice, setTableChoice] = useState<{ schemaId: string | null; header: string; line: string }>({
    schemaId: null,
    header: "",
    line: "",
  });
  const defaultHeader =
    tables.find((t) => lineTableCandidates(tables, t.name).length > 0)?.name ?? tables[0]?.name ?? "";
  const headerTable =
    tableChoice.schemaId === schemaId && tables.some((t) => t.name === tableChoice.header)
      ? tableChoice.header
      : defaultHeader;
  const candidates = lineTableCandidates(tables, headerTable);
  const lineTable =
    tableChoice.schemaId === schemaId && candidates.includes(tableChoice.line)
      ? tableChoice.line
      : candidates[0] ?? "";

  const specs = layout ? getMappingKeySpecs(layout.documentType, layout.mappingKeys) : [];
  const headerSpecs = specs.filter((s) => s.scope === "header");
  const lineSpecs = specs.filter((s) => s.scope === "line");
  const headerColumns = tables.find((t) => t.name === headerTable)?.columns ?? [];
  const lineColumns = tables.find((t) => t.name === lineTable)?.columns ?? [];

  // Mappings reset to fresh suggestions whenever the schema/tables/template change
  const basis = `${schemaId}|${headerTable}|${lineTable}|${templateId}|${layout?.mappingKeys.join(",")}`;
  const [mappingState, setMappingState] = useState<{ basis: string; fields: Record<string, string> }>({
    basis: "",
    fields: {},
  });
  const suggested = useMemo(
    () => suggestMapping(specs, headerColumns.map((c) => c.name), lineColumns.map((c) => c.name)),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- basis captures every input
    [basis]
  );
  const fields = mappingState.basis === basis ? mappingState.fields : suggested;

  const mapping = { headerTable, ...(lineTable && { lineTable }), fields };
  const errors = layout && schema ? validateDocumentMapping(mapping, layout, tables) : [];

  const [count, setCount] = useState(String(DOCUMENT_DEFAULT_COUNT));
  const [seed, setSeed] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { jobs, isLoading, loadError, reload, upsertJob } = useWorkspaceJobs(workspaceId);

  function setField(key: string, column: string) {
    setMappingState({ basis, fields: { ...fields, [key]: column } });
  }

  async function handleGenerate() {
    if (!schema || !template || errors.length) return;
    const rowCount = Number(count);
    if (!Number.isInteger(rowCount) || rowCount < 1 || rowCount > DOCUMENT_MAX_COUNT) {
      toast.error(`Document count must be between 1 and ${DOCUMENT_MAX_COUNT}.`);
      return;
    }
    const seedValue = seed.trim() === "" ? undefined : Number(seed);
    if (seedValue !== undefined && !Number.isSafeInteger(seedValue)) {
      toast.error("Seed must be a whole number.");
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          schemaId: schema.id,
          rowCount,
          ...(seedValue !== undefined && { seed: seedValue }),
          document: { templateId: template.id, mapping },
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
      upsertJob(body as JobRow);
      toast.success("PDF generation started", {
        description: `Rendering ${rowCount} ${layout ? DOCUMENT_TYPE_LABELS[layout.documentType].toLowerCase() : "document"}${rowCount === 1 ? "" : "s"} with “${template.name}”.`,
      });
    } catch (err) {
      toast.error("Could not start PDF generation", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  const docNoun = layout ? DOCUMENT_TYPE_LABELS[layout.documentType].toLowerCase() : "document";

  return (
    <div className="flex flex-col gap-8">
      <div className="grid gap-6 lg:grid-cols-2">
        {/* 1. Data source */}
        <Card>
          <CardContent className="p-5">
            <StepHeading step={1} title="Data source" />
            {groups.length === 0 ? (
              <p className="text-sm text-[var(--color-muted-foreground)]">
                Save a schema in the Schema Designer tab first (for invoices, e.g. an <code>orders</code> table
                and an <code>order_items</code> table with a foreign key to it).
              </p>
            ) : (
              <div className="grid gap-4">
                <div className="grid gap-1.5">
                  <span className="text-sm font-medium">Schema</span>
                  <Select value={schemaId ?? undefined} onValueChange={setSchemaId}>
                    <SelectTrigger><SelectValue placeholder="Select a schema" /></SelectTrigger>
                    <SelectContent>
                      {groups.flatMap((g) =>
                        g.versions.map((v) => (
                          <SelectItem key={v.id} value={v.id}>
                            {g.name} · v{v.version} ({v.tables.length} table{v.tables.length === 1 ? "" : "s"})
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="grid gap-1.5">
                    <span className="text-sm font-medium">One {docNoun} per row of</span>
                    <Select
                      value={headerTable || undefined}
                      onValueChange={(v) => setTableChoice({ schemaId, header: v, line: "" })}
                    >
                      <SelectTrigger><SelectValue placeholder="Header table" /></SelectTrigger>
                      <SelectContent>
                        {tables.map((t) => (
                          <SelectItem key={t.name} value={t.name}>{t.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-1.5">
                    <span className="text-sm font-medium">Line items from</span>
                    <Select
                      value={lineTable || undefined}
                      onValueChange={(v) => setTableChoice({ schemaId, header: headerTable, line: v })}
                      disabled={candidates.length === 0}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder={candidates.length ? "Child table" : "No child tables"} />
                      </SelectTrigger>
                      <SelectContent>
                        {candidates.map((name) => (
                          <SelectItem key={name} value={name}>{name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                {headerTable && candidates.length === 0 && (
                  <p className="text-xs text-[var(--color-muted-foreground)]">
                    No table has a foreign key to <code>{headerTable}</code>. Add one in the
                    Schema Designer to print line items or transactions.
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* 2. Template picker */}
        <Card>
          <CardContent className="p-5">
            <StepHeading step={2} title="Visual template">
              <Link href="/templates" className="inline-flex items-center gap-1 text-xs text-[var(--color-primary)] hover:underline">
                <LayoutTemplate className="size-3.5" />Manage templates
              </Link>
            </StepHeading>
            {documentTemplates.length === 0 ? (
              <div className="flex flex-col items-start gap-3 text-sm text-[var(--color-muted-foreground)]">
                You don&apos;t have any invoice or statement templates yet.
                <Button asChild size="sm"><Link href="/templates">Create a template</Link></Button>
              </div>
            ) : (
              <div className="grid max-h-80 grid-cols-3 gap-3 overflow-y-auto pr-1 sm:grid-cols-4">
                {documentTemplates.map((t) => {
                  const selected = t.id === templateId;
                  const tLayout = readDocumentLayout(t.layoutConfig)!;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setTemplateId(t.id)}
                      aria-pressed={selected}
                      className={cn(
                        "flex flex-col gap-1.5 rounded-md border p-2 text-left transition-colors",
                        selected
                          ? "border-[var(--color-primary)] bg-[var(--color-accent)] ring-1 ring-[var(--color-primary)]"
                          : "border-[var(--color-border)] hover:bg-[var(--color-accent)]"
                      )}
                    >
                      <TemplateThumbnail config={t.layoutConfig} />
                      <span className="truncate text-xs font-medium" title={t.name}>{t.name}</span>
                      <span className="text-[10px] text-[var(--color-muted-foreground)]">
                        {DOCUMENT_TYPE_LABELS[tLayout.documentType]}
                        {!t.isOwner && " · public"}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* 3. Mapping canvas */}
      {schema && layout && headerTable && (
        <Card>
          <CardContent className="p-5">
            <StepHeading step={3} title="Map schema columns to template fields">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setMappingState({ basis, fields: suggested })}
              >
                <Wand2 />Auto-map
              </Button>
            </StepHeading>

            <div className="grid gap-6 lg:grid-cols-2">
              <div className="flex flex-col gap-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)]">
                  {DOCUMENT_TYPE_LABELS[layout.documentType]} header · from <code>{headerTable}</code>
                </p>
                {headerSpecs.map((spec) => (
                  <MappingRow
                    key={spec.key}
                    spec={spec}
                    table={headerTable}
                    columns={headerColumns}
                    value={fields[spec.key] ?? ""}
                    onChange={(c) => setField(spec.key, c)}
                  />
                ))}
              </div>
              <div className="flex flex-col gap-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)]">
                  {layout.documentType === "invoice" ? "Line items" : "Transactions"} · from{" "}
                  <code>{lineTable || "—"}</code>
                </p>
                {lineTable ? (
                  lineSpecs.map((spec) => (
                    <MappingRow
                      key={spec.key}
                      spec={spec}
                      table={lineTable}
                      columns={lineColumns}
                      value={fields[spec.key] ?? ""}
                      onChange={(c) => setField(spec.key, c)}
                    />
                  ))
                ) : (
                  <p className="rounded-md border border-dashed border-[var(--color-border)] p-4 text-sm text-[var(--color-muted-foreground)]">
                    Select a child table of <code>{headerTable}</code> to map line fields.
                  </p>
                )}
              </div>
            </div>

            {errors.length > 0 && (
              <ul className="mt-4 list-disc pl-5 text-sm text-[var(--color-destructive)]" role="alert">
                {errors.map((e) => <li key={e}>{e}</li>)}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      {/* 4. Generate */}
      <Card>
        <CardContent className="flex flex-wrap items-end gap-4 p-5">
          <div className="mr-auto">
            <StepHeading step={4} title="Generate PDF" />
            <p className="text-sm text-[var(--color-muted-foreground)]">
              Generates fresh relational data and renders one {docNoun} per <code>{headerTable || "row"}</code> row
              into a single multi-page PDF (max {DOCUMENT_MAX_COUNT}).
            </p>
          </div>
          <div className="grid gap-1.5">
            <label htmlFor="doc-count" className="text-sm font-medium">Documents</label>
            <Input
              id="doc-count"
              type="number"
              min={1}
              max={DOCUMENT_MAX_COUNT}
              step={1}
              className="w-28"
              value={count}
              onChange={(e) => setCount(e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <label htmlFor="doc-seed" className="text-sm font-medium">Seed</label>
            <Input
              id="doc-seed"
              type="number"
              step={1}
              placeholder="Random"
              className="w-32"
              value={seed}
              onChange={(e) => setSeed(e.target.value)}
            />
          </div>
          <Button
            onClick={handleGenerate}
            disabled={!schema || !template || errors.length > 0 || isSubmitting}
          >
            {isSubmitting ? <Loader2 className="animate-spin" /> : <FileText />}
            {isSubmitting ? "Starting…" : "Generate PDF"}
          </Button>
        </CardContent>
      </Card>

      <JobHistoryTable
        jobs={jobs}
        isLoading={isLoading}
        loadError={loadError}
        onReload={() => reload()}
        onJobUpdate={upsertJob}
      />
    </div>
  );
}
