"use client";

import { ArrowRight, Link2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { CardinalityConstraint } from "@/types/database";

// ============================================
// Types — UI-only; resolved to names on save
// ============================================

export type Cardinality = CardinalityConstraint["relationship"];

/**
 * Foreign key settings on a ColumnRow. Targets are referenced by the stable
 * client ids of the parent table / column so renames propagate automatically.
 */
export interface ForeignKeyDraft {
  targetTableId: string;
  targetColumnId: string;
  cardinality: Cardinality;
  minRecords: number; // min child rows per parent key
  maxRecords: number; // max child rows per parent key
}

/** Minimal view of a table the builder can point at. */
export interface ParentTableOption {
  id: string;
  name: string;
  columns: { id: string; name: string; isPrimaryKey: boolean }[];
}

export const CARDINALITY_OPTIONS: { value: Cardinality; label: string }[] = [
  { value: "oneToOne", label: "1:1" },
  { value: "oneToMany", label: "1:N" },
  { value: "manyToMany", label: "N:M" },
];

export const MAX_CHILD_RECORDS = 1000;

export function cardinalityLabel(value: Cardinality): string {
  return CARDINALITY_OPTIONS.find((o) => o.value === value)?.label ?? value;
}

/** Builds a new FK draft pointing at the first parent table that has a PK. */
export function createForeignKeyDraft(
  parents: ParentTableOption[]
): ForeignKeyDraft | null {
  for (const table of parents) {
    const pk = table.columns.find((c) => c.isPrimaryKey);
    if (pk) {
      return {
        targetTableId: table.id,
        targetColumnId: pk.id,
        cardinality: "oneToMany",
        minRecords: 1,
        maxRecords: 5,
      };
    }
  }
  return null;
}

/**
 * Finds a cycle in the table dependency graph (child → parent edges).
 * Returns the table ids along the cycle with the first id repeated at the
 * end (e.g. [A, B, A]), or null when the graph is acyclic.
 */
export function findDependencyCycle(
  edges: Map<string, Set<string>>
): string[] | null {
  const state = new Map<string, "visiting" | "done">();
  const stack: string[] = [];

  function visit(node: string): string[] | null {
    state.set(node, "visiting");
    stack.push(node);
    for (const next of edges.get(node) ?? []) {
      const s = state.get(next);
      if (s === "visiting") {
        return [...stack.slice(stack.indexOf(next)), next];
      }
      if (s === undefined) {
        const found = visit(next);
        if (found) return found;
      }
    }
    stack.pop();
    state.set(node, "done");
    return null;
  }

  for (const node of edges.keys()) {
    if (!state.has(node)) {
      const found = visit(node);
      if (found) return found;
    }
  }
  return null;
}

function clampCount(raw: string): number {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n)) return 0;
  return Math.min(Math.max(n, 0), MAX_CHILD_RECORDS);
}

// ============================================
// RelationshipBadge — "→ Users.id" next to FK columns
// ============================================

export function RelationshipBadge({
  tableName,
  columnName,
  cardinality,
}: {
  tableName: string | null;
  columnName: string | null;
  cardinality: Cardinality;
}) {
  const resolved = Boolean(tableName && columnName);
  return (
    <Badge
      variant={resolved ? "secondary" : "destructive"}
      className="shrink-0 gap-1 font-mono text-[10px]"
      title={resolved ? `References ${tableName}.${columnName}` : "Unresolved foreign key"}
    >
      <ArrowRight className="size-3" />
      {resolved ? `${tableName}.${columnName}` : "unset"}
      <span className="opacity-60">{cardinalityLabel(cardinality)}</span>
    </Badge>
  );
}

// ============================================
// ForeignKeyBuilder
// ============================================

interface ForeignKeyBuilderProps {
  value: ForeignKeyDraft;
  /** Candidate parent tables (the column's own table excluded). */
  parents: ParentTableOption[];
  onChange: (next: ForeignKeyDraft) => void;
}

export default function ForeignKeyBuilder({
  value,
  parents,
  onChange,
}: ForeignKeyBuilderProps) {
  const target = parents.find((t) => t.id === value.targetTableId) ?? null;
  const pkColumns = target?.columns.filter((c) => c.isPrimaryKey) ?? [];
  const isOneToOne = value.cardinality === "oneToOne";

  function handleTableChange(tableId: string) {
    const table = parents.find((t) => t.id === tableId);
    const pk = table?.columns.find((c) => c.isPrimaryKey);
    onChange({ ...value, targetTableId: tableId, targetColumnId: pk?.id ?? "" });
  }

  function handleCardinalityChange(cardinality: Cardinality) {
    onChange(
      cardinality === "oneToOne"
        ? { ...value, cardinality, minRecords: 1, maxRecords: 1 }
        : { ...value, cardinality }
    );
  }

  return (
    <div className="flex flex-wrap items-end gap-3 rounded-md border border-dashed border-[var(--color-border)] bg-[var(--color-muted)]/40 px-3 py-2">
      <div className="flex items-center gap-1.5 self-center text-xs font-medium text-[var(--color-muted-foreground)]">
        <Link2 className="size-3.5" />
        References
      </div>

      {/* Target parent table */}
      <div className="flex flex-col gap-1">
        <span className="text-[11px] text-[var(--color-muted-foreground)]">
          Parent table
        </span>
        <Select value={value.targetTableId || undefined} onValueChange={handleTableChange}>
          <SelectTrigger className="h-8 w-40">
            <SelectValue placeholder="Select table" />
          </SelectTrigger>
          <SelectContent>
            {parents.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.name || "(unnamed table)"}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Target primary key column */}
      <div className="flex flex-col gap-1">
        <span className="text-[11px] text-[var(--color-muted-foreground)]">
          Primary key
        </span>
        <Select
          value={value.targetColumnId || undefined}
          onValueChange={(targetColumnId) => onChange({ ...value, targetColumnId })}
          disabled={pkColumns.length === 0}
        >
          <SelectTrigger className="h-8 w-36">
            <SelectValue
              placeholder={target ? "No primary key" : "Select table first"}
            />
          </SelectTrigger>
          <SelectContent>
            {pkColumns.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name || "(unnamed column)"}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Cardinality */}
      <div className="flex flex-col gap-1">
        <span className="text-[11px] text-[var(--color-muted-foreground)]">
          Cardinality
        </span>
        <Select
          value={value.cardinality}
          onValueChange={(v) => handleCardinalityChange(v as Cardinality)}
        >
          <SelectTrigger className="h-8 w-24">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CARDINALITY_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Child distribution range */}
      <div className="flex flex-col gap-1">
        <span className="text-[11px] text-[var(--color-muted-foreground)]">
          Rows per parent (min – max)
        </span>
        <div className="flex items-center gap-1.5">
          <Input
            type="number"
            min={0}
            max={MAX_CHILD_RECORDS}
            value={value.minRecords}
            disabled={isOneToOne}
            onChange={(e) => onChange({ ...value, minRecords: clampCount(e.target.value) })}
            className="h-8 w-20"
            aria-label="Minimum child rows per parent"
          />
          <span className="text-xs text-[var(--color-muted-foreground)]">–</span>
          <Input
            type="number"
            min={1}
            max={MAX_CHILD_RECORDS}
            value={value.maxRecords}
            disabled={isOneToOne}
            onChange={(e) => onChange({ ...value, maxRecords: clampCount(e.target.value) })}
            className="h-8 w-20"
            aria-label="Maximum child rows per parent"
          />
        </div>
      </div>
    </div>
  );
}
