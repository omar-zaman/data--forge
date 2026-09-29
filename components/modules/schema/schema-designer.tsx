"use client";

import { useState, useEffect } from "react";
import { toast } from "sonner";
import { ArrowUp, ArrowDown, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type {
  TableStructure,
  ColumnDefinition,
  ColumnConstraint,
} from "@/types/database";

// ============================================
// UIDataType — human-readable column type labels
// ============================================

export type UIDataType =
  | "Name"
  | "FirstName"
  | "LastName"
  | "Email"
  | "Phone"
  | "Address"
  | "City"
  | "Country"
  | "ZipCode"
  | "Company"
  | "JobTitle"
  | "UUID"
  | "Integer"
  | "Float"
  | "Boolean"
  | "Date"
  | "DateTime"
  | "Text"
  | "URL"
  | "IPAddress";

const UI_DATA_TYPES: UIDataType[] = [
  "Name",
  "FirstName",
  "LastName",
  "Email",
  "Phone",
  "Address",
  "City",
  "Country",
  "ZipCode",
  "Company",
  "JobTitle",
  "UUID",
  "Integer",
  "Float",
  "Boolean",
  "Date",
  "DateTime",
  "Text",
  "URL",
  "IPAddress",
];

// ============================================
// ColumnRow — UI-only state; NOT persisted directly
// ============================================

export interface ColumnRow {
  id: string; // crypto.randomUUID() — stable React key, never sent to API
  name: string; // sanitized column name
  type: UIDataType; // maps to ColumnDefinition.type string on save
  nullRate: number; // 0–100 slider value
  isUnique: boolean; // true → add { type: "UNIQUE" } to col.constraints
  isPrimaryKey: boolean; // true → col.primaryKey = true (only one allowed at a time)
}

// ============================================
// Pure helper functions
// ============================================

/**
 * Sanitizes a raw column name input:
 * - Replaces any character that is not alphanumeric or underscore with "_"
 * - Strips leading digits so the result is a valid identifier
 */
export function sanitizeColumnName(raw: string): string {
  const replaced = raw.replace(/[^a-zA-Z0-9_]/g, "_");
  return replaced.replace(/^[0-9]+/, "");
}

/**
 * Maps ColumnRow[] → a single TableStructure ready for the API payload.
 * - nullRates stored as Record<string, number> on TableStructure
 * - isUnique → ColumnConstraint { type: "UNIQUE" }
 * - isPrimaryKey → ColumnDefinition.primaryKey = true
 * - nullRate > 0 → ColumnDefinition.nullable = true
 */
export function columnRowsToTableStructure(
  name: string,
  rows: ColumnRow[]
): TableStructure {
  const columns: ColumnDefinition[] = rows.map((row) => {
    const constraints: ColumnConstraint[] = [];
    if (row.isUnique) {
      constraints.push({ type: "UNIQUE" });
    }
    return {
      name: row.name,
      type: row.type, // UIDataType string stored as-is
      nullable: row.nullRate > 0,
      primaryKey: row.isPrimaryKey || undefined,
      constraints: constraints.length > 0 ? constraints : undefined,
    };
  });

  const nullRatesMap: Record<string, number> = {};
  for (const row of rows) {
    if (row.nullRate > 0) {
      nullRatesMap[row.name] = row.nullRate;
    }
  }

  return {
    name,
    columns,
    nullRates:
      Object.keys(nullRatesMap).length > 0 ? nullRatesMap : undefined,
  };
}

/**
 * Maps a stored ColumnDefinition back to a ColumnRow for editing.
 * - id generated via crypto.randomUUID() (client-side only — component is "use client")
 * - col.type mapped back to UIDataType; unknown types fall back to "Text"
 * - nullRate pulled from nullRates[col.name] ?? 0
 * - isUnique derived from constraints containing { type: "UNIQUE" }
 * - isPrimaryKey from col.primaryKey
 */
export function colDefToColumnRow(
  col: ColumnDefinition,
  nullRates: Record<string, number>
): ColumnRow {
  return {
    id: crypto.randomUUID(),
    name: col.name,
    type: stringToUIDataType(col.type),
    nullRate: nullRates[col.name] ?? 0,
    isUnique: col.constraints?.some((c) => c.type === "UNIQUE") ?? false,
    isPrimaryKey: col.primaryKey ?? false,
  };
}

/** Converts a stored type string back to a UIDataType, defaulting to "Text" for unknown values. */
function stringToUIDataType(value: string): UIDataType {
  return (UI_DATA_TYPES as string[]).includes(value)
    ? (value as UIDataType)
    : "Text";
}

// ============================================
// Default ColumnRow factory
// ============================================

function createDefaultColumnRow(): ColumnRow {
  return {
    id: crypto.randomUUID(),
    name: "",
    type: "Name",
    nullRate: 0,
    isUnique: false,
    isPrimaryKey: false,
  };
}

// ============================================
// Component props
// ============================================

interface SchemaDesignerProps {
  workspaceId: string;
}

// ============================================
// SchemaDesigner component
// ============================================

export default function SchemaDesigner({ workspaceId }: SchemaDesignerProps) {
  // --- State ---
  const [schemaName, setSchemaName] = useState<string>("");
  const [columns, setColumns] = useState<ColumnRow[]>([]);
  const [existingSchemaId, setExistingSchemaId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState<number>(0);

  // ============================================
  // Load existing schema on mount (re-runs on retry)
  // ============================================

  useEffect(() => {
    let cancelled = false;

    async function loadSchema() {
      setIsLoading(true);
      setLoadError(null);

      try {
        const res = await fetch(`/api/schemas?workspaceId=${workspaceId}`);

        if (!res.ok) {
          const errBody = await res.json().catch(() => ({}));
          const message =
            (errBody as { error?: string }).error ??
            `Failed to load schema (HTTP ${res.status})`;
          throw new Error(message);
        }

        const result = (await res.json()) as Array<{
          id: string;
          name: string | null;
          tables: unknown;
        }>;

        if (cancelled) return;

        if (result.length > 0) {
          const first = result[0];

          // `tables` arrives as a parsed JSON array from the Prisma Json field.
          // Guard against the rare case where it might still be a string.
          let rawTables: unknown = first.tables;
          if (typeof rawTables === "string") {
            try {
              rawTables = JSON.parse(rawTables);
            } catch {
              rawTables = [];
            }
          }

          const tables = Array.isArray(rawTables)
            ? (rawTables as TableStructure[])
            : [];

          if (tables.length > 0 && Array.isArray(tables[0].columns)) {
            const nullRates: Record<string, number> =
              tables[0].nullRates ?? {};
            const mappedColumns = tables[0].columns.map((col) =>
              colDefToColumnRow(col, nullRates)
            );
            setSchemaName(first.name ?? "");
            setColumns(mappedColumns);
          } else {
            setSchemaName(first.name ?? "");
          }

          setExistingSchemaId(first.id);
        }
        // Empty array → leave columns as [] (empty state shown automatically)
      } catch (err) {
        if (cancelled) return;
        const message =
          err instanceof Error
            ? err.message
            : "Failed to load schema";
        setLoadError(message);
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    void loadSchema();

    return () => {
      cancelled = true;
    };
  }, [workspaceId, retryCount]);

  // ============================================
  // Handlers
  // ============================================

  function handleAddColumn() {
    setColumns((prev) => [...prev, createDefaultColumnRow()]);
  }

  function handleDeleteColumn(id: string) {
    setColumns((prev) => prev.filter((col) => col.id !== id));
  }

  function handleMoveUp(index: number) {
    if (index === 0) return;
    setColumns((prev) => {
      const next = [...prev];
      [next[index - 1], next[index]] = [next[index], next[index - 1]];
      return next;
    });
  }

  function handleMoveDown(index: number) {
    setColumns((prev) => {
      if (index === prev.length - 1) return prev;
      const next = [...prev];
      [next[index], next[index + 1]] = [next[index + 1], next[index]];
      return next;
    });
  }

  function handleColumnChange(
    id: string,
    field: keyof Omit<ColumnRow, "id">,
    value: ColumnRow[keyof Omit<ColumnRow, "id">]
  ) {
    setColumns((prev) =>
      prev.map((col) => {
        if (col.id !== id) {
          // Enforce single-PK: clear isPrimaryKey on all other rows when a new PK is set
          if (field === "isPrimaryKey" && value === true) {
            return { ...col, isPrimaryKey: false };
          }
          return col;
        }
        return { ...col, [field]: value };
      })
    );
  }

  // ============================================
  // Loading / Error states
  // ============================================

  if (isLoading) {
    return (
      <div className="flex flex-col gap-4 py-4">
        {/* Schema name input skeleton */}
        <Skeleton className="h-9 w-72 rounded-md mb-4" />
        {/* Three column row skeletons */}
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex gap-3">
            <Skeleton className="h-9 flex-1 rounded-md" />
            <Skeleton className="h-9 w-32 rounded-md" />
            <Skeleton className="h-9 w-24 rounded-md" />
            <Skeleton className="h-5 w-10 rounded-full" />
          </div>
        ))}
      </div>
    );
  }

  if (loadError !== null) {
    return (
      <div className="flex items-center gap-3 rounded-md border border-[var(--color-destructive)] bg-[var(--color-destructive)]/10 p-4 text-sm text-[var(--color-destructive)]">
        <span>Error: {loadError}</span>
        <button
          className="underline hover:no-underline"
          onClick={() => setRetryCount((c) => c + 1)}
        >
          Retry
        </button>
      </div>
    );
  }

  // ============================================
  // Main UI
  // ============================================

  return (
    <div className="flex flex-col gap-6">
      {/* Schema name input */}
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="schema-name"
          className="text-sm font-medium text-[var(--color-foreground)]"
        >
          Schema Name
        </label>
        <Input
          id="schema-name"
          placeholder="e.g. customers"
          value={schemaName}
          onChange={(e) => setSchemaName(e.target.value)}
          className="max-w-sm"
        />
      </div>

      {/* Column list or empty state */}
      {columns.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-12">
            <p className="text-sm text-[var(--color-muted-foreground)]">
              No columns yet — add your first column
            </p>
            <Button onClick={handleAddColumn}>Add Column</Button>
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-2">
          {/* Column header row */}
          <div className="grid grid-cols-[1fr_160px_120px_80px_60px_60px_auto] items-center gap-3 px-1 text-xs font-medium text-[var(--color-muted-foreground)]">
            <span>Name</span>
            <span>Type</span>
            <span>Null Rate</span>
            <span>Unique</span>
            <span>PK</span>
            <span></span>
            <span></span>
          </div>

          {/* Column rows */}
          {columns.map((row, index) => (
            <div
              key={row.id}
              className="grid grid-cols-[1fr_160px_120px_80px_60px_60px_auto] items-center gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-2"
            >
              {/* Name */}
              <Input
                placeholder="column_name"
                value={row.name}
                onChange={(e) =>
                  handleColumnChange(
                    row.id,
                    "name",
                    sanitizeColumnName(e.target.value)
                  )
                }
              />

              {/* Type */}
              <Select
                value={row.type}
                onValueChange={(value) =>
                  handleColumnChange(row.id, "type", value as UIDataType)
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {UI_DATA_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* Null rate */}
              <div className="flex items-center gap-2">
                <Slider
                  min={0}
                  max={100}
                  step={1}
                  value={[row.nullRate]}
                  onValueChange={([val]) =>
                    handleColumnChange(row.id, "nullRate", val)
                  }
                  className="flex-1"
                />
                <span className="w-9 text-right text-xs tabular-nums text-[var(--color-muted-foreground)]">
                  {row.nullRate}%
                </span>
              </div>

              {/* Unique */}
              <div className="flex flex-col items-center gap-1">
                <Switch
                  checked={row.isUnique}
                  onCheckedChange={(checked) =>
                    handleColumnChange(row.id, "isUnique", checked)
                  }
                  aria-label="Unique"
                />
              </div>

              {/* Primary Key */}
              <div className="flex flex-col items-center gap-1">
                <Switch
                  checked={row.isPrimaryKey}
                  onCheckedChange={(checked) =>
                    handleColumnChange(row.id, "isPrimaryKey", checked)
                  }
                  aria-label="Primary Key"
                />
              </div>

              {/* Reorder & delete */}
              <div className="flex items-center gap-0.5">
                <Button
                  variant="ghost"
                  size="icon"
                  disabled={index === 0}
                  onClick={() => handleMoveUp(index)}
                  aria-label="Move column up"
                >
                  <ArrowUp />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  disabled={index === columns.length - 1}
                  onClick={() => handleMoveDown(index)}
                  aria-label="Move column down"
                >
                  <ArrowDown />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => handleDeleteColumn(row.id)}
                  aria-label="Delete column"
                  className="text-[var(--color-destructive)] hover:text-[var(--color-destructive)]"
                >
                  <Trash2 />
                </Button>
              </div>
            </div>
          ))}

          {/* Add Column button (below list) */}
          <Button
            variant="outline"
            onClick={handleAddColumn}
            className="mt-2 self-start"
          >
            Add Column
          </Button>
        </div>
      )}

      {/* Save Schema button — wired up in task 5.1 */}
      {columns.length > 0 && (
        <div className="flex justify-end">
          <Button disabled={isSaving}>
            {isSaving ? "Saving…" : "Save Schema"}
          </Button>
        </div>
      )}
    </div>
  );
}
