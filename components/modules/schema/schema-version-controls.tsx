"use client";

import { useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, GitBranchPlus, History, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import type { SchemaGroup } from "./schema-picker";

interface SchemaVersionControlsProps {
  workspaceId: string;
  group: SchemaGroup;
  activeSchemaId: string;
  onSelectVersion: (schemaId: string) => void;
  onVersionCreated: (schemaId: string) => void;
  onDeleted: (schemaId: string) => void;
}

async function errorMessage(res: Response, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  return body.error ?? `${fallback} (HTTP ${res.status})`;
}

/**
 * Toolbar above the designer: version history picker, "New Version"
 * snapshot, and a guarded delete for the version currently open.
 */
export default function SchemaVersionControls({
  workspaceId,
  group,
  activeSchemaId,
  onSelectVersion,
  onVersionCreated,
  onDeleted,
}: SchemaVersionControlsProps) {
  const [isCreating, setIsCreating] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [jobCount, setJobCount] = useState<number | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const active = group.versions.find((v) => v.id === activeSchemaId);
  const latestVersion = group.versions[0]?.version;
  const isOnlyVersion = group.versions.length === 1;
  const isPastVersion = active !== undefined && active.version !== latestVersion;

  async function handleNewVersion() {
    setIsCreating(true);
    try {
      const res = await fetch(`/api/schemas/${activeSchemaId}/versions`, {
        method: "POST",
      });
      if (!res.ok) {
        throw new Error(await errorMessage(res, "Failed to create version"));
      }
      const created = (await res.json()) as { id: string; version: number };
      toast.success(`Created v${created.version}`, { description: group.name });
      onVersionCreated(created.id);
    } catch (err) {
      toast.error("Could not create version", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setIsCreating(false);
    }
  }

  function handleConfirmOpenChange(next: boolean) {
    if (isDeleting) return;
    setConfirmOpen(next);
    if (!next) return;

    // Look up how many jobs the cascade will remove so the warning is accurate
    setJobCount(null);
    const params = new URLSearchParams({
      workspaceId,
      schemaId: activeSchemaId,
      limit: "1",
    });
    fetch(`/api/jobs?${params}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { pagination?: { total?: number } } | null) =>
        setJobCount(body?.pagination?.total ?? 0)
      )
      .catch(() => setJobCount(0));
  }

  async function handleDelete() {
    setIsDeleting(true);
    try {
      const res = await fetch(`/api/schemas/${activeSchemaId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        throw new Error(await errorMessage(res, "Failed to delete schema"));
      }
      toast.success(
        isOnlyVersion ? "Schema deleted" : `Deleted v${active?.version}`,
        { description: group.name }
      );
      setConfirmOpen(false);
      onDeleted(activeSchemaId);
    } catch (err) {
      toast.error("Could not delete schema", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <History className="size-4 text-[var(--color-muted-foreground)]" />
        <span className="text-sm font-medium">Version</span>
        <Select value={activeSchemaId} onValueChange={onSelectVersion}>
          <SelectTrigger className="w-44" aria-label="Version history">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {group.versions.map((v) => (
              <SelectItem key={v.id} value={v.id}>
                v{v.version}
                {v.version === latestVersion ? " (latest)" : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button
          variant="outline"
          size="sm"
          onClick={handleNewVersion}
          disabled={isCreating}
          title="Copy the saved version into a new version and open it"
        >
          {isCreating ? <Loader2 className="animate-spin" /> : <GitBranchPlus />}
          New Version
        </Button>

        <AlertDialog open={confirmOpen} onOpenChange={handleConfirmOpenChange}>
          <AlertDialogTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto text-[var(--color-destructive)] hover:text-[var(--color-destructive)]"
            >
              <Trash2 />
              {isOnlyVersion ? "Delete Schema" : "Delete Version"}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {isOnlyVersion
                  ? `Delete schema “${group.name}”?`
                  : `Delete v${active?.version} of “${group.name}”?`}
              </AlertDialogTitle>
              <AlertDialogDescription>
                This cannot be undone.
                {!isOnlyVersion && " Other versions of this schema are kept."}
              </AlertDialogDescription>
            </AlertDialogHeader>

            {jobCount === null ? (
              <p className="flex items-center gap-2 text-sm text-[var(--color-muted-foreground)]">
                <Loader2 className="size-4 animate-spin" />
                Checking for generation jobs…
              </p>
            ) : jobCount > 0 ? (
              <div className="flex gap-2 rounded-md border border-[var(--color-destructive)]/40 bg-[var(--color-destructive)]/10 p-3 text-sm">
                <AlertTriangle className="size-4 shrink-0 text-[var(--color-destructive)]" />
                <span>
                  {jobCount} generation job{jobCount === 1 ? "" : "s"} created
                  from this version will also be deleted, including{" "}
                  {jobCount === 1 ? "its" : "their"} export history.
                </span>
              </div>
            ) : null}

            <AlertDialogFooter>
              <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
              {/* Plain button (not AlertDialogAction) so the dialog stays open while deleting */}
              <Button
                variant="destructive"
                onClick={handleDelete}
                disabled={isDeleting || jobCount === null}
              >
                {isDeleting && <Loader2 className="animate-spin" />}
                {isDeleting ? "Deleting…" : "Delete"}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      {isPastVersion && (
        <p className="text-xs text-[var(--color-muted-foreground)]">
          Viewing v{active?.version}, an older version. Saving overwrites it in
          place; “New Version” copies it forward as v{(latestVersion ?? 0) + 1}.
        </p>
      )}
    </div>
  );
}
