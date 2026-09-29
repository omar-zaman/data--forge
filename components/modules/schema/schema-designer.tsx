"use client";

import { useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowUp,
  ArrowDown,
  Loader2,
  RefreshCcw,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent } from "@/components/ui/card";
import LivePreviewCanvas, { type PreviewTableSpec } from "./live-preview-canvas";
import type { RelationalForeignKeyInput } from "@/lib/engine/relational-engine";
import ForeignKeyBuilder, {
  RelationshipBadge,
  createForeignKeyDraft,
  findDependencyCycle,
  type ForeignKeyDraft,
  type ParentTableOption,
} from "./foreign-key-builder";
import TableManagerBar, { type TableTabSummary } from "./table-manager-bar";
import { SUPPORTED_TYPES } from "@/lib/engine/tabular-engine";
import type {
  TableStructure,
  ColumnDefinition,
  ColumnConstraint,
  ForeignKeyConstraint,
  CardinalityConstraint,
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

// Sourced from the generation engine so the dropdown always offers exactly
// the types the backend can generate.
const UI_DATA_TYPES = SUPPORTED_TYPES as UIDataType[];

/** Sentinel Select value for the "Foreign Key" column type (relational only). */
const FOREIGN_KEY_TYPE = "__foreign_key__";

export type SchemaDataType = "TABULAR" | "RELATIONAL";

// ============================================
// ColumnRow / TableDraft — UI-only state; NOT persisted directly
// ============================================

export interface ColumnRow {
  id: string; // crypto.randomUUID() — stable React key, never sent to API
  name: string; // sanitized column name
  type: UIDataType; // maps to ColumnDefinition.type string on save
  nullRate: number; // 0–100 slider value
  isUnique: boolean; // true → add { type: "UNIQUE" } to col.constraints
  isPrimaryKey: boolean; // true → col.primaryKey = true (only one allowed at a time)
  foreignKey?: ForeignKeyDraft | null; // set → column references a parent PK
}

export interface TableDraft {
  id: string; // client-only stable id
  name: string; // sanitized table name
  columns: ColumnRow[];
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

/** Table names follow the same identifier rules as column names. */
export const sanitizeTableName = sanitizeColumnName;

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
    foreignKey: null,
  };
}

/** Converts a stored type string back to a UIDataType, defaulting to "Text" for unknown values. */
function stringToUIDataType(value: string): UIDataType {
  return (UI_DATA_TYPES as string[]).includes(value)
    ? (value as UIDataType)
    : "Text";
}

/**
 * The type an FK column is generated/stored as: the parent PK column's type,
 * so values stay compatible with the key they reference.
 */
function resolveColumnType(row: ColumnRow, tables: TableDraft[]): UIDataType {
  if (!row.foreignKey) return row.type;
  const parent = tables.find((t) => t.id === row.foreignKey?.targetTableId);
  const pk = parent?.columns.find((c) => c.id === row.foreignKey?.targetColumnId);
  return pk && !pk.foreignKey ? pk.type : row.type;
}

/** Maps every TableDraft → TableStructure, resolving FK ids to table/column names. */
export function tableDraftsToTableStructures(
  tables: TableDraft[]
): TableStructure[] {
  return tables.map((table) => {
    const rows = table.columns.map((row) => ({
      ...row,
      type: resolveColumnType(row, tables),
    }));
    const structure = columnRowsToTableStructure(table.name, rows);

    const foreignKeys: ForeignKeyConstraint[] = [];
    const cardinalities: Record<string, CardinalityConstraint> = {};
    for (const row of table.columns) {
      const fk = row.foreignKey;
      if (!fk) continue;
      const parent = tables.find((t) => t.id === fk.targetTableId);
      const pk = parent?.columns.find((c) => c.id === fk.targetColumnId);
      if (!parent || !pk) continue; // blocked by validation before save
      foreignKeys.push({
        fromColumn: row.name,
        toTable: parent.name,
        toColumn: pk.name,
      });
      cardinalities[row.name] = {
        relationship: fk.cardinality,
        targetTable: parent.name,
        minRecords: fk.minRecords,
        maxRecords: fk.maxRecords,
      };
    }

    return foreignKeys.length > 0
      ? { ...structure, foreignKeys, cardinalities }
      : structure;
  });
}

// ============================================
// Default factories
// ============================================

function createDefaultColumnRow(): ColumnRow {
  return {
    id: crypto.randomUUID(),
    name: "",
    type: "Name",
    nullRate: 0,
    isUnique: false,
    isPrimaryKey: false,
    foreignKey: null,
  };
}

function createTableDraft(name: string, withIdColumn: boolean): TableDraft {
  return {
    id: crypto.randomUUID(),
    name,
    columns: withIdColumn
      ? [{ ...createDefaultColumnRow(), name: "id", type: "UUID", isPrimaryKey: true }]
      : [],
  };
}

// ============================================
// Component props
// ============================================

/** Plain, serializable schema data handed down from the Server Component. */
export interface InitialSchema {
  id: string;
  name: string | null;
  dataType?: string;
  tables: TableStructure[];
}

interface SchemaDesignerProps {
  workspaceId: string;
  initialSchema: InitialSchema | null;
  /** Called with the schema id after every successful save. */
  onSchemaSaved?: (schemaId: string) => void;
  /** Extra buttons rendered beside "Save Schema" (e.g. Generate Data). */
  actions?: ReactNode;
}

function initialDataTypeFrom(schema: InitialSchema | null): SchemaDataType {
  if (schema?.dataType === "RELATIONAL") return "RELATIONAL";
  if (schema?.dataType === "TABULAR") return "TABULAR";
  // Older payloads without dataType: infer from the stored structure
  const tables = schema?.tables ?? [];
  return tables.length > 1 || tables.some((t) => t.foreignKeys?.length)
    ? "RELATIONAL"
    : "TABULAR";
}

function initialTablesFrom(schema: InitialSchema | null): TableDraft[] {
  const stored = (schema?.tables ?? []).filter((t) => Array.isArray(t.columns));
  if (stored.length === 0) return [createTableDraft("", false)];

  // Pass 1: rows with fresh client ids
  const drafts: TableDraft[] = stored.map((table) => {
    const nullRates = table.nullRates ?? {};
    return {
      id: crypto.randomUUID(),
      name: table.name ?? "",
      columns: table.columns.map((col) => colDefToColumnRow(col, nullRates)),
    };
  });

  // Pass 2: resolve stored FK names → client ids
  stored.forEach((table, i) => {
    for (const fk of table.foreignKeys ?? []) {
      const row = drafts[i].columns.find((c) => c.name === fk.fromColumn);
      if (!row) continue;
      const parent = drafts.find((d) => d.name === fk.toTable);
      const pk = parent?.columns.find((c) => c.name === fk.toColumn);
      const card = table.cardinalities?.[fk.fromColumn];
      row.foreignKey = {
        targetTableId: parent?.id ?? "",
        targetColumnId: pk?.id ?? "",
        cardinality: card?.relationship ?? "oneToMany",
        minRecords: card?.minRecords ?? 1,
        maxRecords: card?.maxRecords ?? 5,
      };
    }
  });

  return drafts;
}

/**
 * Checks the column state against the rules the backend enforces
 * (validateTableStructure) plus rules that keep the stored JSON coherent.
 * Returns an error message, or null when the schema can be saved.
 */
function validateBeforeSave(
  schemaName: string,
  rows: ColumnRow[]
): string | null {
  if (!schemaName.trim()) return "Schema name is required.";
  if (rows.length === 0) return "Add at least one column.";
  if (rows.some((row) => !row.name)) return "Every column needs a name.";

  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.name)) return `Duplicate column name "${row.name}".`;
    seen.add(row.name);
  }

  if (!rows.some((row) => row.isPrimaryKey)) {
    return "Mark one column as the primary key (PK).";
  }
  return null;
}

interface SchemaIssue {
  tableId: string | null;
  message: string;
  kind: "error" | "cycle";
}

/**
 * Validates a relational (multi-table) draft: per-table structure, every FK
 * pointing at an existing parent PK, sane cardinality ranges, and no cyclic
 * table dependencies.
 */
function validateRelationalSchema(tables: TableDraft[]): SchemaIssue[] {
  const issues: SchemaIssue[] = [];
  const push = (tableId: string | null, message: string) =>
    issues.push({ tableId, message, kind: "error" });

  if (tables.length === 0) push(null, "Add at least one table.");

  const seenTables = new Set<string>();
  for (const table of tables) {
    const label = table.name || "(unnamed table)";
    if (!table.name) push(table.id, "Every table needs a name.");
    else if (seenTables.has(table.name.toLowerCase()))
      push(table.id, `Duplicate table name "${table.name}".`);
    seenTables.add(table.name.toLowerCase());

    const error = validateBeforeSave("_", table.columns);
    if (error) push(table.id, `${label}: ${error}`);

    for (const row of table.columns) {
      const fk = row.foreignKey;
      if (!fk) continue;
      const colLabel = `${label}.${row.name || "(unnamed)"}`;
      const parent = tables.find((t) => t.id === fk.targetTableId);
      const pk = parent?.columns.find((c) => c.id === fk.targetColumnId);
      if (!parent) push(table.id, `${colLabel}: select a parent table.`);
      else if (parent.id === table.id)
        push(table.id, `${colLabel}: a table cannot reference itself.`);
      else if (!pk) push(table.id, `${colLabel}: select the parent's primary key column.`);
      else if (!pk.isPrimaryKey)
        push(table.id, `${colLabel}: ${parent.name}.${pk.name} is no longer a primary key.`);

      if (fk.maxRecords < 1) push(table.id, `${colLabel}: max rows per parent must be at least 1.`);
      if (fk.minRecords > fk.maxRecords)
        push(table.id, `${colLabel}: min rows per parent cannot exceed max.`);
      if (fk.cardinality === "oneToOne" && fk.maxRecords !== 1)
        push(table.id, `${colLabel}: a 1:1 relationship allows exactly one row per parent.`);
    }
  }

  // Cycle detection on child → parent edges
  const edges = new Map<string, Set<string>>();
  for (const table of tables) {
    const parents = new Set<string>();
    for (const row of table.columns) {
      const target = row.foreignKey?.targetTableId;
      if (target && tables.some((t) => t.id === target)) parents.add(target);
    }
    edges.set(table.id, parents);
  }
  const cycle = findDependencyCycle(edges);
  if (cycle) {
    const names = cycle.map(
      (id) => tables.find((t) => t.id === id)?.name || "(unnamed)"
    );
    issues.unshift({
      tableId: cycle[0],
      message: `Cyclic foreign key dependency: ${names.join(" → ")}. Remove one of these references.`,
      kind: "cycle",
    });
  }

  return issues;
}

function nextTableName(tables: TableDraft[]): string {
  const taken = new Set(tables.map((t) => t.name.toLowerCase()));
  let n = tables.length + 1;
  while (taken.has(`table_${n}`)) n++;
  return `table_${n}`;
}

// ============================================
// SchemaDesigner component
// ============================================

export default function SchemaDesigner({
  workspaceId,
  initialSchema,
  onSchemaSaved,
  actions,
}: SchemaDesignerProps) {
  // --- State (seeded from the server-fetched schema; no client load) ---
  const [schemaName, setSchemaName] = useState<string>(
    initialSchema?.name ?? ""
  );
  const [dataType, setDataType] = useState<SchemaDataType>(() =>
    initialDataTypeFrom(initialSchema)
  );
  const [tables, setTables] = useState<TableDraft[]>(() =>
    initialTablesFrom(initialSchema)
  );
  const [activeTableId, setActiveTableId] = useState<string>(
    () => tables[0].id
  );
  const [existingSchemaId, setExistingSchemaId] = useState<string | null>(
    initialSchema?.id ?? null
  );
  const [isSaving, setIsSaving] = useState<boolean>(false);

  const isRelational = dataType === "RELATIONAL";
  const activeTable =
    tables.find((t) => t.id === activeTableId) ?? tables[0];
  const columns = activeTable.columns;

  // Real-time relational validation (cycles, dangling FKs, …)
  const issues = useMemo(
    () => (isRelational ? validateRelationalSchema(tables) : []),
    [isRelational, tables]
  );

  // Candidate parent tables for FKs in the active table
  const parentOptions: ParentTableOption[] = useMemo(
    () =>
      tables
        .filter((t) => t.id !== activeTable.id)
        .map((t) => ({
          id: t.id,
          name: t.name,
          columns: t.columns.map((c) => ({
            id: c.id,
            name: c.name,
            isPrimaryKey: c.isPrimaryKey,
          })),
        })),
    [tables, activeTable.id]
  );

  // Preview FK columns with the parent PK's type (memoized so the canvas
  // only regenerates when the active table's columns actually change)
  const previewColumns = useMemo(
    () =>
      activeTable.columns.map((row) =>
        row.foreignKey ? { ...row, type: resolveColumnType(row, tables) } : row
      ),
    [activeTable.columns, tables]
  );

  // Relational preview: every table with its links, keyed by client ids so
  // half-typed names never break a link. Incomplete FK drafts are skipped.
  const previewTables: PreviewTableSpec[] = useMemo(
    () =>
      tables.map((table) => {
        const foreignKeys: RelationalForeignKeyInput[] = [];
        const cardinalities: Record<string, CardinalityConstraint> = {};
        for (const row of table.columns) {
          const fk = row.foreignKey;
          const parent = fk && tables.find((t) => t.id === fk.targetTableId);
          const pk = parent?.columns.find((c) => c.id === fk?.targetColumnId);
          if (!fk || !parent || !pk || parent.id === table.id) continue;
          foreignKeys.push({
            fromColumn: row.name,
            fromKey: row.id,
            toTable: parent.name,
            toColumn: pk.name,
            toKey: pk.id,
          });
          cardinalities[row.name] = {
            relationship: fk.cardinality,
            targetTable: parent.name,
            minRecords: fk.minRecords,
            maxRecords: fk.maxRecords,
          };
        }
        return {
          name: table.name,
          columns: table.columns.map((row) =>
            row.foreignKey ? { ...row, type: resolveColumnType(row, tables) } : row
          ),
          foreignKeys,
          cardinalities,
        };
      }),
    [tables]
  );

  const tabSummaries: TableTabSummary[] = tables.map((t) => ({
    id: t.id,
    name: t.name,
    columnCount: t.columns.length,
    foreignKeyCount: t.columns.filter((c) => c.foreignKey).length,
    hasErrors: issues.some((i) => i.tableId === t.id),
  }));

  // ============================================
  // Save — POST when new, PATCH when updating
  // ============================================

  async function handleSave() {
    const name = schemaName.trim();
    let payloadTables: TableStructure[];

    if (isRelational) {
      if (!name) {
        toast.error("Cannot save schema", { description: "Schema name is required." });
        return;
      }
      const blocking = validateRelationalSchema(tables);
      if (blocking.length > 0) {
        toast.error(
          blocking[0].kind === "cycle" ? "Cyclic table dependency" : "Cannot save schema",
          {
            description:
              blocking.length > 1
                ? `${blocking[0].message} (+${blocking.length - 1} more issue${blocking.length === 2 ? "" : "s"})`
                : blocking[0].message,
          }
        );
        return;
      }
      payloadTables = tableDraftsToTableStructures(tables);
    } else {
      const validationError = validateBeforeSave(schemaName, columns);
      if (validationError) {
        toast.error("Cannot save schema", { description: validationError });
        return;
      }
      payloadTables = [
        columnRowsToTableStructure(sanitizeColumnName(name) || "table", columns),
      ];
    }

    setIsSaving(true);
    try {
      const res = existingSchemaId
        ? await fetch(`/api/schemas/${existingSchemaId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name, dataType, tables: payloadTables }),
          })
        : await fetch("/api/schemas", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              workspaceId,
              name,
              dataType,
              tables: payloadTables,
            }),
          });

      if (!res.ok) {
        const errBody = (await res.json().catch(() => ({}))) as {
          error?: string;
          code?: string;
          details?: string[];
        };
        if (errBody.code === "SCHEMA_LOCKED") {
          toast.error(
            errBody.error ??
              "Cannot edit a schema that has existing generation jobs. Please create a new version."
          );
          return;
        }
        const message =
          errBody.details?.join("; ") ??
          errBody.error ??
          `HTTP ${res.status}`;
        throw new Error(message);
      }

      const saved = (await res.json()) as { id: string };
      setExistingSchemaId(saved.id);
      onSchemaSaved?.(saved.id);
      toast.success("Schema saved", {
        description: isRelational
          ? `"${name}" with ${tables.length} table${tables.length === 1 ? "" : "s"}.`
          : `"${name}" with ${columns.length} column${columns.length === 1 ? "" : "s"}.`,
      });
    } catch (err) {
      toast.error("Failed to save schema", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setIsSaving(false);
    }
  }

  // ============================================
  // Table handlers
  // ============================================

  function handleDataTypeChange(next: SchemaDataType) {
    if (next === dataType) return;
    if (next === "TABULAR") {
      if (tables.length > 1 || tables.some((t) => t.columns.some((c) => c.foreignKey))) {
        toast.error("Cannot switch to Tabular", {
          description: "Tabular schemas have a single table. Remove extra tables and foreign keys first.",
        });
        return;
      }
    } else if (!tables[0].name) {
      // Seed the first table's name from the schema name
      setTables((prev) => [
        { ...prev[0], name: sanitizeTableName(schemaName.trim()) || "table_1" },
        ...prev.slice(1),
      ]);
    }
    setDataType(next);
  }

  function handleAddTable() {
    const table = createTableDraft(nextTableName(tables), true);
    setTables((prev) => [...prev, table]);
    setActiveTableId(table.id);
  }

  function handleDeleteTable(tableId: string) {
    if (tables.length <= 1) return;
    const referencing = tables
      .filter((t) => t.id !== tableId)
      .flatMap((t) =>
        t.columns
          .filter((c) => c.foreignKey?.targetTableId === tableId)
          .map((c) => `${t.name || "(unnamed)"}.${c.name || "(unnamed)"}`)
      );
    if (referencing.length > 0) {
      const target = tables.find((t) => t.id === tableId);
      toast.error(`Cannot delete "${target?.name || "(unnamed)"}"`, {
        description: `It is referenced by ${referencing.join(", ")}. Remove those foreign keys first.`,
      });
      return;
    }
    const index = tables.findIndex((t) => t.id === tableId);
    const remaining = tables.filter((t) => t.id !== tableId);
    setTables(remaining);
    if (tableId === activeTableId) {
      setActiveTableId(remaining[Math.max(0, index - 1)].id);
    }
  }

  function handleRenameTable(raw: string) {
    const name = sanitizeTableName(raw);
    setTables((prev) =>
      prev.map((t) => (t.id === activeTable.id ? { ...t, name } : t))
    );
  }

  // ============================================
  // Column handlers (operate on the active table)
  // ============================================

  function updateColumns(update: (prev: ColumnRow[]) => ColumnRow[]) {
    setTables((prev) =>
      prev.map((t) =>
        t.id === activeTable.id ? { ...t, columns: update(t.columns) } : t
      )
    );
  }

  function handleAddColumn() {
    updateColumns((prev) => [...prev, createDefaultColumnRow()]);
  }

  function handleDeleteColumn(id: string) {
    updateColumns((prev) => prev.filter((col) => col.id !== id));
  }

  function handleMoveUp(index: number) {
    if (index === 0) return;
    updateColumns((prev) => {
      const next = [...prev];
      [next[index - 1], next[index]] = [next[index], next[index - 1]];
      return next;
    });
  }

  function handleMoveDown(index: number) {
    updateColumns((prev) => {
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
    updateColumns((prev) =>
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

  function handleTypeChange(row: ColumnRow, value: string) {
    if (value !== FOREIGN_KEY_TYPE) {
      updateColumns((prev) =>
        prev.map((col) =>
          col.id === row.id
            ? { ...col, type: value as UIDataType, foreignKey: null }
            : col
        )
      );
      return;
    }
    if (row.foreignKey) return;
    const draft = createForeignKeyDraft(parentOptions);
    if (!draft) {
      toast.warning("Define a parent table first", {
        description:
          "Add another table with a primary key column before creating a foreign key.",
      });
      return;
    }
    handleColumnChange(row.id, "foreignKey", draft);
  }

  // ============================================
  // Main UI
  // ============================================

  const hasAnyColumns = tables.some((t) => t.columns.length > 0);
  const cycleIssue = issues.find((i) => i.kind === "cycle");
  const otherIssues = issues.filter((i) => i.kind !== "cycle");

  return (
    <div className="flex flex-col gap-6">
      {/* Schema name + data type */}
      <div className="flex flex-wrap items-end gap-4">
        <div className="flex min-w-60 max-w-sm flex-1 flex-col gap-1.5">
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
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-[var(--color-foreground)]">
            Schema Type
          </span>
          <Select
            value={dataType}
            onValueChange={(v) => handleDataTypeChange(v as SchemaDataType)}
          >
            <SelectTrigger className="w-52" aria-label="Schema type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="TABULAR">Tabular (single table)</SelectItem>
              <SelectItem value="RELATIONAL">Relational (multi-table)</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Tables toolbar + active table name */}
      {isRelational && (
        <div className="flex flex-col gap-3">
          <TableManagerBar
            tables={tabSummaries}
            activeTableId={activeTable.id}
            onSelect={setActiveTableId}
            onAdd={handleAddTable}
            onDelete={handleDeleteTable}
          />
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="table-name"
              className="text-sm font-medium text-[var(--color-foreground)]"
            >
              Table Name
            </label>
            <Input
              id="table-name"
              placeholder="e.g. orders"
              value={activeTable.name}
              onChange={(e) => handleRenameTable(e.target.value)}
              className="max-w-sm font-mono"
            />
          </div>
        </div>
      )}

      {/* Relational validation */}
      {cycleIssue && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-[var(--color-destructive)] bg-[var(--color-destructive)]/10 px-3 py-2 text-sm text-[var(--color-destructive)]"
        >
          <RefreshCcw className="mt-0.5 size-4 shrink-0" />
          <span>{cycleIssue.message}</span>
        </div>
      )}
      {otherIssues.length > 0 && (
        <div className="flex flex-col gap-1 rounded-lg border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
          <span className="flex items-center gap-2 font-medium">
            <AlertTriangle className="size-4" />
            {otherIssues.length} issue{otherIssues.length === 1 ? "" : "s"} to fix before saving
          </span>
          <ul className="ml-6 list-disc text-xs">
            {otherIssues.slice(0, 6).map((issue, i) => (
              <li key={i}>{issue.message}</li>
            ))}
            {otherIssues.length > 6 && <li>…and {otherIssues.length - 6} more</li>}
          </ul>
        </div>
      )}

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
          {columns.map((row, index) => {
            const fk = row.foreignKey;
            const fkParent = fk ? tables.find((t) => t.id === fk.targetTableId) : undefined;
            const fkColumn = fkParent?.columns.find((c) => c.id === fk?.targetColumnId);
            return (
              <div
                key={row.id}
                className="flex flex-col gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-2"
              >
                <div className="grid grid-cols-[1fr_160px_120px_80px_60px_60px_auto] items-center gap-3">
                  {/* Name + relationship badge */}
                  <div className="flex min-w-0 items-center gap-2">
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
                      className="min-w-0"
                    />
                    {fk && (
                      <RelationshipBadge
                        tableName={fkParent?.name || null}
                        columnName={fkColumn?.name || null}
                        cardinality={fk.cardinality}
                      />
                    )}
                  </div>

                  {/* Type */}
                  <Select
                    value={fk ? FOREIGN_KEY_TYPE : row.type}
                    onValueChange={(value) => handleTypeChange(row, value)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {isRelational && (
                        <>
                          <SelectItem value={FOREIGN_KEY_TYPE}>Foreign Key</SelectItem>
                          <SelectSeparator />
                        </>
                      )}
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

                {/* Foreign key configuration */}
                {fk && (
                  <ForeignKeyBuilder
                    value={fk}
                    parents={parentOptions}
                    onChange={(next) => handleColumnChange(row.id, "foreignKey", next)}
                  />
                )}
              </div>
            );
          })}

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

      {/* Live preview — regenerates on every column change */}
      <LivePreviewCanvas
        tables={isRelational ? previewTables : undefined}
        columns={previewColumns}
        activeTable={activeTable.name}
      />

      {/* Save Schema */}
      <div className="flex justify-end gap-2">
        {actions}
        <Button
          onClick={handleSave}
          disabled={isSaving || !hasAnyColumns}
        >
          {isSaving && <Loader2 className="animate-spin" />}
          {isSaving ? "Saving…" : "Save Schema"}
        </Button>
      </div>
    </div>
  );
}
