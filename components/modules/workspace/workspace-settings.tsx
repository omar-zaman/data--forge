"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Settings, Trash2 } from "lucide-react";
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
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

const NAME_MAX = 100;
const DESCRIPTION_MAX = 500;

interface WorkspaceSettingsProps {
  workspaceId: string;
  name: string;
  description: string | null;
}

async function errorMessage(res: Response, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  return body.error ?? `${fallback} (HTTP ${res.status})`;
}

/**
 * Gear-icon settings dialog for a workspace: rename / edit description, and a
 * danger zone that deletes the workspace after a typed-name confirmation.
 */
export default function WorkspaceSettings({
  workspaceId,
  name: currentName,
  description: currentDescription,
}: WorkspaceSettingsProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(currentName);
  const [description, setDescription] = useState(currentDescription ?? "");
  const [isSaving, setIsSaving] = useState(false);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);

  const isBusy = isSaving || isDeleting;
  const trimmedName = name.trim();
  const isDirty =
    trimmedName !== currentName ||
    description.trim() !== (currentDescription ?? "");

  function handleOpenChange(next: boolean) {
    // Prevent closing mid-request
    if (isBusy) return;
    setOpen(next);
    if (next) {
      // Re-seed from the latest server values each time the dialog opens
      setName(currentName);
      setDescription(currentDescription ?? "");
    }
  }

  function handleConfirmOpenChange(next: boolean) {
    if (isDeleting) return;
    setConfirmOpen(next);
    if (!next) setConfirmText("");
  }

  async function handleRename(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!trimmedName) {
      toast.error("Workspace name is required");
      return;
    }

    setIsSaving(true);
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: trimmedName,
          description: description.trim() || null,
        }),
      });
      if (!res.ok) {
        throw new Error(await errorMessage(res, "Failed to update workspace"));
      }

      toast.success("Workspace updated", { description: trimmedName });
      setOpen(false);
      router.refresh();
    } catch (err) {
      toast.error("Could not update workspace", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete() {
    if (confirmText !== currentName) return;

    setIsDeleting(true);
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        throw new Error(await errorMessage(res, "Failed to delete workspace"));
      }

      toast.success("Workspace deleted", { description: currentName });
      router.push("/dashboard");
      router.refresh();
    } catch (err) {
      toast.error("Could not delete workspace", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
      setIsDeleting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="icon" aria-label="Workspace settings">
          <Settings />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={handleRename} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Workspace settings</DialogTitle>
            <DialogDescription>
              Rename this workspace or update its description.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-1.5">
            <label htmlFor="settings-workspace-name" className="text-sm font-medium">
              Name
            </label>
            <Input
              id="settings-workspace-name"
              value={name}
              maxLength={NAME_MAX}
              onChange={(e) => setName(e.target.value)}
              disabled={isBusy}
              required
            />
          </div>

          <div className="grid gap-1.5">
            <label
              htmlFor="settings-workspace-description"
              className="text-sm font-medium"
            >
              Description{" "}
              <span className="font-normal text-[var(--color-muted-foreground)]">
                (optional)
              </span>
            </label>
            <textarea
              id="settings-workspace-description"
              value={description}
              maxLength={DESCRIPTION_MAX}
              onChange={(e) => setDescription(e.target.value)}
              disabled={isBusy}
              rows={3}
              className="flex min-h-[72px] w-full resize-none rounded-md border border-[var(--color-border)] bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-[var(--color-muted-foreground)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-ring)] disabled:cursor-not-allowed disabled:opacity-50"
            />
          </div>

          <DialogFooter>
            <Button type="submit" disabled={isBusy || !trimmedName || !isDirty}>
              {isSaving && <Loader2 className="animate-spin" />}
              {isSaving ? "Saving…" : "Save Changes"}
            </Button>
          </DialogFooter>
        </form>

        {/* Danger zone */}
        <div className="mt-2 grid gap-3 rounded-lg border border-[var(--color-destructive)]/40 p-4">
          <div>
            <p className="text-sm font-semibold text-[var(--color-destructive)]">
              Delete workspace
            </p>
            <p className="text-sm text-[var(--color-muted-foreground)]">
              Permanently removes this workspace with all of its schemas and
              generation jobs.
            </p>
          </div>

          <AlertDialog open={confirmOpen} onOpenChange={handleConfirmOpenChange}>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" className="justify-self-start" disabled={isBusy}>
                <Trash2 />
                Delete Workspace
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete “{currentName}”?</AlertDialogTitle>
                <AlertDialogDescription>
                  This cannot be undone. All schemas, schema versions and
                  generation jobs in this workspace will be deleted.
                </AlertDialogDescription>
              </AlertDialogHeader>

              <div className="grid gap-1.5">
                <label htmlFor="confirm-workspace-name" className="text-sm">
                  Type <span className="font-semibold">{currentName}</span> to
                  confirm.
                </label>
                <Input
                  id="confirm-workspace-name"
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  disabled={isDeleting}
                  autoComplete="off"
                  autoFocus
                />
              </div>

              <AlertDialogFooter>
                <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
                {/* Plain button (not AlertDialogAction) so the dialog stays open while deleting */}
                <Button
                  variant="destructive"
                  onClick={handleDelete}
                  disabled={isDeleting || confirmText !== currentName}
                >
                  {isDeleting && <Loader2 className="animate-spin" />}
                  {isDeleting ? "Deleting…" : "Delete Workspace"}
                </Button>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </DialogContent>
    </Dialog>
  );
}
