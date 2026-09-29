"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Plus } from "lucide-react";
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

const NAME_MAX = 100;
const DESCRIPTION_MAX = 500;

export default function CreateWorkspaceDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  function resetForm() {
    setName("");
    setDescription("");
  }

  function handleOpenChange(next: boolean) {
    // Prevent closing mid-request
    if (isSubmitting) return;
    setOpen(next);
    if (!next) resetForm();
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) {
      toast.error("Workspace name is required");
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch("/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: trimmedName,
          description: description.trim() || null,
        }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Failed to create workspace (HTTP ${res.status})`);
      }

      const workspace = (await res.json()) as { id: string; name: string };
      toast.success("Workspace created", { description: workspace.name });
      setOpen(false);
      resetForm();
      router.refresh();
    } catch (err) {
      toast.error("Could not create workspace", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button>
          <Plus />
          New Workspace
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={handleSubmit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Create workspace</DialogTitle>
            <DialogDescription>
              Workspaces group your schema definitions and generation jobs.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-1.5">
            <label htmlFor="workspace-name" className="text-sm font-medium">
              Name
            </label>
            <Input
              id="workspace-name"
              placeholder="e.g. Customer Analytics"
              value={name}
              maxLength={NAME_MAX}
              onChange={(e) => setName(e.target.value)}
              disabled={isSubmitting}
              autoFocus
              required
            />
          </div>

          <div className="grid gap-1.5">
            <label htmlFor="workspace-description" className="text-sm font-medium">
              Description{" "}
              <span className="font-normal text-[var(--color-muted-foreground)]">
                (optional)
              </span>
            </label>
            <textarea
              id="workspace-description"
              placeholder="What is this workspace for?"
              value={description}
              maxLength={DESCRIPTION_MAX}
              onChange={(e) => setDescription(e.target.value)}
              disabled={isSubmitting}
              rows={3}
              className="flex min-h-[72px] w-full resize-none rounded-md border border-[var(--color-border)] bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-[var(--color-muted-foreground)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-ring)] disabled:cursor-not-allowed disabled:opacity-50"
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting || !name.trim()}>
              {isSubmitting && <Loader2 className="animate-spin" />}
              {isSubmitting ? "Creating…" : "Create Workspace"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
