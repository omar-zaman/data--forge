"use client";

import { useState } from "react";
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
import { toJobRow, type JobRow } from "./job-history-table";

const DEFAULT_ROW_COUNT = 1000;
const MAX_ROW_COUNT = 1_000_000;

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
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

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
        body: JSON.stringify({ workspaceId, schemaId, ...parsed }),
      });

      if (!res.ok) {
        const errBody = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(errBody.error ?? `HTTP ${res.status}`);
      }

      onJobCreated(toJobRow(await res.json()));
      toast.success("Generation job started", {
        description: `Generating ${parsed.rowCount.toLocaleString()} rows.`,
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
