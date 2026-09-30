"use client";

import { useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toJobRow, type JobRow } from "./job-history-table";

const DEFAULT_ROW_COUNT = 1000;
const MAX_ROW_COUNT = 1_000_000;
/** Mirrors PDF_REPORT_MAX_ROWS in the job service. */
const PDF_REPORT_ROWS = 500;

type ExportFormatOption = "CSV" | "JSON" | "SQL" | "PDF" | "ZIP";

const FORMAT_OPTIONS: { value: ExportFormatOption; label: string; hint: string }[] = [
  { value: "CSV", label: "CSV", hint: "One CSV per table (multi-table schemas download as a ZIP)." },
  { value: "JSON", label: "JSON", hint: "A JSON array of records (multi-table schemas download as a ZIP)." },
  { value: "SQL", label: "SQL", hint: "CREATE TABLE statements plus INSERTs for PostgreSQL / MySQL." },
  {
    value: "PDF",
    label: "PDF",
    hint: `A styled PDF report with the first ${PDF_REPORT_ROWS} rows of each table. CSV, JSON and SQL files are still produced.`,
  },
  { value: "ZIP", label: "ZIP", hint: "Every table as CSV and JSON plus the SQL dump in one archive." },
];

/** Formats whose export is styled by a visual template (CSV/JSON/SQL/ZIP are raw data). */
const TEMPLATED_FORMATS: ReadonlySet<ExportFormatOption> = new Set(["PDF"]);
/** Select value for the built-in layout; sent to the API as templateId: null. */
const DEFAULT_TEMPLATE_VALUE = "__default__";

interface TemplateOption {
  id: string;
  name: string;
}

async function fetchTemplates(url: string): Promise<TemplateOption[]> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as TemplateOption[];
  return data.map(({ id, name }) => ({ id, name }));
}

interface RunGenerationModalProps {
  workspaceId: string;
  /** The saved schema to generate from; null until the schema is saved. */
  schemaId: string | null;
  onJobCreated: (job: JobRow) => void;
}

/**
 * Parses the form inputs. Returns an error message, or the payload values
 * when the inputs are valid.
 */
function parseForm(
  rowCountRaw: string,
  seedRaw: string
): { error: string } | { rowCount: number; seed?: number } {
  const rowCount = Number(rowCountRaw);
  if (!Number.isInteger(rowCount) || rowCount < 1 || rowCount > MAX_ROW_COUNT) {
    return {
      error: `Row count must be a whole number between 1 and ${MAX_ROW_COUNT.toLocaleString()}.`,
    };
  }

  if (seedRaw.trim() === "") return { rowCount };

  const seed = Number(seedRaw);
  if (!Number.isSafeInteger(seed)) {
    return { error: "Seed must be a whole number." };
  }
  return { rowCount, seed };
}

export default function RunGenerationModal({
  workspaceId,
  schemaId,
  onJobCreated,
}: RunGenerationModalProps) {
  const [open, setOpen] = useState(false);
  const [rowCount, setRowCount] = useState(String(DEFAULT_ROW_COUNT));
  const [seed, setSeed] = useState("");
  const [exportFormat, setExportFormat] = useState<ExportFormatOption>("CSV");
  const [templateValue, setTemplateValue] = useState(DEFAULT_TEMPLATE_VALUE);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // The caller's own templates (GET /api/templates is scoped to the session user).
  // SWR caches and dedupes across opens; failures fall back to the default template.
  const usesTemplate = TEMPLATED_FORMATS.has(exportFormat);
  const { data: templates, isLoading: templatesLoading } = useSWR(
    open ? "/api/templates" : null,
    fetchTemplates,
    { revalidateOnFocus: false, dedupingInterval: 60_000, shouldRetryOnError: false }
  );
  const templateOptions = templates ?? [];
  const hasTemplates = templateOptions.length > 0;
  // A template deleted since it was picked falls back to the default
  const selectedTemplate = templateOptions.some((t) => t.id === templateValue)
    ? templateValue
    : DEFAULT_TEMPLATE_VALUE;

  function handleOpenChange(next: boolean) {
    if (isSubmitting) return;
    setOpen(next);
    if (!next) setFormError(null);
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!schemaId) return;

    const parsed = parseForm(rowCount, seed);
    if ("error" in parsed) {
      setFormError(parsed.error);
      return;
    }
    setFormError(null);

    setIsSubmitting(true);
    try {
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          schemaId,
          exportFormat,
          ...parsed,
          ...(usesTemplate &&
            selectedTemplate !== DEFAULT_TEMPLATE_VALUE && { templateId: selectedTemplate }),
        }),
      });

      if (!res.ok) {
        const errBody = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(errBody.error ?? `HTTP ${res.status}`);
      }

      onJobCreated(toJobRow(await res.json()));
      toast.success("Generation job started", {
        description: `Generating ${parsed.rowCount.toLocaleString()} rows as ${exportFormat}.`,
      });
      setOpen(false);
    } catch (err) {
      toast.error("Failed to start generation", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button
          variant="secondary"
          disabled={!schemaId}
          title={schemaId ? undefined : "Save the schema before generating data"}
        >
          <Sparkles />
          Generate Data
        </Button>
      </DialogTrigger>

      <DialogContent className="max-w-md">
        <form onSubmit={handleSubmit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Generate Data</DialogTitle>
            <DialogDescription>
              Runs a generation job against the last saved version of this
              schema.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-1.5">
            <label htmlFor="gen-row-count" className="text-sm font-medium">
              Row Count
            </label>
            <Input
              id="gen-row-count"
              type="number"
              inputMode="numeric"
              min={1}
              max={MAX_ROW_COUNT}
              step={1}
              required
              value={rowCount}
              onChange={(e) => setRowCount(e.target.value)}
            />
          </div>

          <div className="grid gap-1.5">
            <label htmlFor="gen-seed" className="text-sm font-medium">
              Seed{" "}
              <span className="font-normal text-[var(--color-muted-foreground)]">
                (optional)
              </span>
            </label>
            <Input
              id="gen-seed"
              type="number"
              inputMode="numeric"
              step={1}
              placeholder="Random"
              value={seed}
              onChange={(e) => setSeed(e.target.value)}
            />
            <p className="text-xs text-[var(--color-muted-foreground)]">
              Use the same seed to reproduce an identical dataset.
            </p>
          </div>

          <div className="grid gap-1.5">
            <label htmlFor="gen-export-format" className="text-sm font-medium">
              Export Format
            </label>
            <Select
              value={exportFormat}
              onValueChange={(v) => setExportFormat(v as ExportFormatOption)}
            >
              <SelectTrigger id="gen-export-format">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FORMAT_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-[var(--color-muted-foreground)]">
              {FORMAT_OPTIONS.find((o) => o.value === exportFormat)?.hint}
            </p>
          </div>

          {usesTemplate && (
            <div className="grid gap-1.5">
              <label htmlFor="gen-template" className="text-sm font-medium">
                Select Template
              </label>
              <Select
                value={selectedTemplate}
                onValueChange={setTemplateValue}
                disabled={templatesLoading || !hasTemplates}
              >
                <SelectTrigger id="gen-template">
                  {templatesLoading ? (
                    <span className="flex items-center gap-2 text-[var(--color-muted-foreground)]">
                      <Loader2 className="size-4 animate-spin" />
                      Loading templates…
                    </span>
                  ) : (
                    <SelectValue />
                  )}
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={DEFAULT_TEMPLATE_VALUE}>Default System Template</SelectItem>
                  {templateOptions.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-[var(--color-muted-foreground)]">
                Defines the visual layout of your exported documents.
              </p>
            </div>
          )}

          {formError && (
            <p className="text-sm text-[var(--color-destructive)]" role="alert">
              {formError}
            </p>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="animate-spin" />}
              {isSubmitting ? "Starting…" : "Start Generation"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
