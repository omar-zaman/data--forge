"use client";

import { useState } from "react";
import { Link2, Plus, Table2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";

export interface TableTabSummary {
  id: string;
  name: string;
  columnCount: number;
  foreignKeyCount: number;
  hasErrors: boolean;
}

interface TableManagerBarProps {
  tables: TableTabSummary[];
  activeTableId: string;
  onSelect: (tableId: string) => void;
  onAdd: () => void;
  /** Parent decides whether the delete is allowed (e.g. table still referenced). */
  onDelete: (tableId: string) => void;
}

/**
 * Horizontal "Tables" toolbar for relational schemas: one tab per table,
 * plus Add / Delete controls.
 */
export default function TableManagerBar({
  tables,
  activeTableId,
  onSelect,
  onAdd,
  onDelete,
}: TableManagerBarProps) {
  const [pendingDelete, setPendingDelete] = useState<TableTabSummary | null>(null);
  const canDelete = tables.length > 1;

  function requestDelete(table: TableTabSummary) {
    // Empty tables go immediately; tables with columns ask first
    if (table.columnCount === 0) onDelete(table.id);
    else setPendingDelete(table);
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-[var(--color-foreground)]">
          Tables
        </span>
        <Button variant="outline" size="sm" onClick={onAdd}>
          <Plus />
          Add Table
        </Button>
      </div>

      <div
        role="tablist"
        aria-label="Schema tables"
        className="flex gap-2 overflow-x-auto border-b border-[var(--color-border)] pb-2"
      >
        {tables.map((table) => {
          const isActive = table.id === activeTableId;
          return (
            <div
              key={table.id}
              className={cn(
                "group flex shrink-0 items-center rounded-md border text-sm transition-colors",
                isActive
                  ? "border-[var(--color-primary)] bg-[var(--color-primary)]/10 text-[var(--color-foreground)]"
                  : "border-[var(--color-border)] text-[var(--color-muted-foreground)] hover:bg-[var(--color-muted)]"
              )}
            >
              <button
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => onSelect(table.id)}
                className="flex items-center gap-2 py-1.5 pl-3 pr-2"
              >
                <Table2 className="size-4 shrink-0" />
                <span className="font-mono">{table.name || "(unnamed)"}</span>
                <span className="text-xs tabular-nums opacity-70">
                  {table.columnCount} col{table.columnCount === 1 ? "" : "s"}
                </span>
                {table.foreignKeyCount > 0 && (
                  <span
                    className="flex items-center gap-0.5 text-xs opacity-70"
                    title={`${table.foreignKeyCount} foreign key${table.foreignKeyCount === 1 ? "" : "s"}`}
                  >
                    <Link2 className="size-3" />
                    {table.foreignKeyCount}
                  </span>
                )}
                {table.hasErrors && (
                  <span
                    className="size-2 rounded-full bg-[var(--color-destructive)]"
                    title="This table has validation errors"
                  />
                )}
              </button>
              {canDelete && (
                <button
                  type="button"
                  onClick={() => requestDelete(table)}
                  aria-label={`Delete table ${table.name}`}
                  className="mr-1 rounded p-1 opacity-60 hover:bg-[var(--color-muted)] hover:text-[var(--color-destructive)] hover:opacity-100"
                >
                  <X className="size-3.5" />
                </button>
              )}
            </div>
          );
        })}
      </div>

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => !open && setPendingDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete table “{pendingDelete?.name || "(unnamed)"}”?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Its {pendingDelete?.columnCount} column
              {pendingDelete?.columnCount === 1 ? "" : "s"} will be removed from
              this schema draft.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button
              variant="destructive"
              onClick={() => {
                if (pendingDelete) onDelete(pendingDelete.id);
                setPendingDelete(null);
              }}
            >
              Delete Table
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
