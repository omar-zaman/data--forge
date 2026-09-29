"use client";

import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  CornerDownLeft,
  KeyRound,
  Link2,
  Loader2,
  Network,
  RefreshCw,
  TableProperties,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import {
  MAX_PREVIEW_ROWS,
  TabularEngineError,
  randomSeed,
  type CellValue,
  type EngineColumn,
  type GeneratedRow,
} from "@/lib/engine/tabular-engine";
import {
  generateRelationalPreview,
  type RelationalForeignKeyInput,
  type ResolvedForeignKey,
} from "@/lib/engine/relational-engine";
import type { CardinalityConstraint } from "@/types/database";
import ErdVisualizer, { type ErdRelation, type ErdTable } from "./erd-visualizer";
import type { ColumnRow } from "./schema-designer";

// ============================================
// Props
// ============================================

/** One table of the schema being designed. Rows are keyed by ColumnRow.id. */
export interface PreviewTableSpec {
  name: string;
  columns: ColumnRow[];
  /** Pass fromKey/toKey (ColumnRow ids) so links survive half-typed names. */
  foreignKeys?: RelationalForeignKeyInput[];
  /** Rows-per-parent rules, keyed by FK column name. */
  cardinalities?: Record<string, CardinalityConstraint>;
}

interface LivePreviewCanvasProps {
  /** Every table of the schema (relational), previewed together with linked data. */
  tables?: PreviewTableSpec[];
  /** Single-table shorthand, used when `tables` is not given. */
  columns?: ColumnRow[];
  /** Table to show by default (e.g. the one open in the designer). */
  activeTable?: string;
  rowCount?: number; // clamped to 1–MAX_PREVIEW_ROWS
}

interface ReferencedBy {
  table: string;
  column: string;
}

interface PreviewTable {
  name: string;
  columns: EngineColumn[];
  rows: GeneratedRow[];
  /** Keyed by EngineColumn.key of the FK column. */
  foreignKeys: Map<string, ResolvedForeignKey>;
  /** Keyed by EngineColumn.key of the referenced column. */
  referencedBy: Map<string, ReferencedBy[]>;
  depth: number;
}

type PreviewResult =
  | { tables: PreviewTable[]; relations: ErdRelation[]; error: null }
  | { tables: []; relations: []; error: string };

interface PreviewInput {
  tables: PreviewTableSpec[];
  seed: number;
  rowCount: number;
}

/** A parent row to highlight after following a foreign key. */
interface RowFocus {
  table: string;
  key: string;
  value: CellValue;
}

const EMPTY_COLUMNS: ColumnRow[] = [];

function toEngineColumn(col: ColumnRow): EngineColumn {
  return {
    key: col.id,
    name: col.name,
    type: col.type,
    nullRate: col.nullRate,
    isUnique: col.isUnique,
    isPrimaryKey: col.isPrimaryKey,
  };
}

// ============================================
// Preview generation
// ============================================

function buildPreview(input: PreviewInput): PreviewResult {
  try {
    const { plan, rows } = generateRelationalPreview(
      input.tables.map((t) => ({
        name: t.name,
        columns: t.columns.map(toEngineColumn),
        foreignKeys: t.foreignKeys,
        cardinalities: t.cardinalities,
      })),
      input.seed,
      input.rowCount
    );

    const referencedBy = new Map<string, Map<string, ReferencedBy[]>>();
    const relations: ErdRelation[] = [];
    for (const table of plan.tables) {
      for (const fk of table.foreignKeys) {
        const byKey = referencedBy.get(fk.toTable) ?? new Map<string, ReferencedBy[]>();
        byKey.set(fk.toKey, [
          ...(byKey.get(fk.toKey) ?? []),
          { table: table.name, column: fk.fromColumn },
        ]);
        referencedBy.set(fk.toTable, byKey);

        const col = table.columns.find((c) => c.key === fk.fromKey);
        relations.push({
          fromTable: table.name,
          fromColumn: fk.fromColumn,
          toTable: fk.toTable,
          toColumn: fk.toColumn,
          oneToOne: Boolean(col?.isUnique || col?.isPrimaryKey),
        });
      }
    }

    // Tabs follow the schema's own table order; generation used dependency order
    const tables = plan.tables
      .slice()
      .sort((a, b) => a.index - b.index)
      .map((table) => ({
        name: table.name,
        columns: table.columns,
        rows: rows[table.name] ?? [],
        foreignKeys: new Map(table.foreignKeys.map((fk) => [fk.fromKey, fk])),
        referencedBy: referencedBy.get(table.name) ?? new Map(),
        depth: table.depth,
      }));

    return { tables, relations, error: null };
  } catch (err) {
    const message =
      err instanceof TabularEngineError || err instanceof Error
        ? err.message
        : "Failed to generate preview data";
    return { tables: [], relations: [], error: message };
  }
}

// ============================================
// Cell rendering
// ============================================

function NullBadge() {
  return (
    <Badge variant="muted" className="font-mono text-[10px] tracking-wide opacity-70">
      NULL
    </Badge>
  );
}

function renderCell(value: CellValue) {
  if (value === null) return <NullBadge />;
  if (typeof value === "boolean") {
    return <span className="font-mono text-xs">{value ? "true" : "false"}</span>;
  }
  if (typeof value === "number") {
    return <span className="font-mono text-xs tabular-nums">{value}</span>;
  }
  return (
    <span className="block max-w-[260px] truncate" title={value}>
      {value}
    </span>
  );
}

/** FK cell: a link-styled badge that jumps to the referenced parent row. */
function ForeignKeyCell({
  value,
  fk,
  onFollow,
}: {
  value: CellValue;
  fk: ResolvedForeignKey;
  onFollow: () => void;
}) {
  if (value === null) return <NullBadge />;
  const text = String(value);
  return (
    <button
      type="button"
      onClick={onFollow}
      title={`${fk.toTable}.${fk.toColumn} = ${text} — click to view the linked row`}
      className="inline-flex max-w-[200px] items-center gap-1 rounded-md border border-[var(--color-primary)]/40 bg-[var(--color-primary)]/10 px-1.5 py-0.5 font-mono text-[11px] text-[var(--color-primary)] transition-colors hover:bg-[var(--color-primary)]/20"
    >
      <Link2 className="size-3 shrink-0" />
      <span className="truncate">{text}</span>
    </button>
  );
}

function PreviewSkeleton() {
  return (
    <div className="flex flex-col gap-2" aria-busy aria-label="Generating preview">
      <div className="flex gap-2">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-7 w-24 rounded-md" />
        ))}
      </div>
      {Array.from({ length: 6 }, (_, i) => (
        <Skeleton key={i} className="h-8 w-full rounded-md" />
      ))}
    </div>
  );
}

// ============================================
// Table view
// ============================================

interface PreviewTableViewProps {
  table: PreviewTable;
  focus: RowFocus | null;
  onFollow: (fk: ResolvedForeignKey, value: CellValue) => void;
  onSelectTable: (name: string) => void;
}

function PreviewTableView({ table, focus, onFollow, onSelectTable }: PreviewTableViewProps) {
  const focusKey = focus?.table === table.name ? focus.key : null;

  return (
    <div className="overflow-x-auto rounded-lg border border-[var(--color-border)]">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-10 text-right">#</TableHead>
            {table.columns.map((col) => {
              const fk = table.foreignKeys.get(col.key);
              const refs = table.referencedBy.get(col.key) ?? [];
              return (
                <TableHead key={col.key} className="align-top">
                  <div className="flex flex-col gap-1 py-1">
                    <span
                      className={cn(
                        "flex items-center gap-1 text-[var(--color-foreground)]",
                        !col.name && "italic text-[var(--color-muted-foreground)]"
                      )}
                    >
                      {col.isPrimaryKey && (
                        <KeyRound className="size-3 text-amber-500" aria-label="Primary key" />
                      )}
                      {col.name || "unnamed"}
                    </span>
                    <span className="text-[10px] font-normal">
                      {col.type}
                      {col.nullRate > 0 && !col.isPrimaryKey && ` · ${col.nullRate}% null`}
                    </span>
                    {(col.isPrimaryKey || col.isUnique || fk || refs.length > 0) && (
                      <div className="flex flex-wrap gap-1">
                        {col.isPrimaryKey && (
                          <Badge
                            variant="outline"
                            className="border-amber-300 bg-amber-50 px-1.5 text-[10px] text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300"
                          >
                            PK
                          </Badge>
                        )}
                        {col.isUnique && !col.isPrimaryKey && (
                          <Badge variant="muted" className="px-1.5 text-[10px]">
                            UQ
                          </Badge>
                        )}
                        {fk && (
                          <button
                            type="button"
                            onClick={() => onSelectTable(fk.toTable)}
                            title={`Foreign key to ${fk.toTable}.${fk.toColumn}`}
                          >
                            <Badge
                              variant="outline"
                              className="gap-1 border-[var(--color-primary)]/40 px-1.5 text-[10px] font-medium text-[var(--color-primary)]"
                            >
                              <Link2 className="size-2.5" />
                              FK → {fk.toTable}.{fk.toColumn}
                            </Badge>
                          </button>
                        )}
                        {refs.map((ref) => (
                          <button
                            key={`${ref.table}.${ref.column}`}
                            type="button"
                            onClick={() => onSelectTable(ref.table)}
                            title={`Referenced by ${ref.table}.${ref.column}`}
                          >
                            <Badge variant="muted" className="gap-1 px-1.5 text-[10px] font-medium">
                              <CornerDownLeft className="size-2.5" />
                              {ref.table}
                            </Badge>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </TableHead>
              );
            })}
          </TableRow>
        </TableHeader>
        <TableBody>
          {table.rows.map((row, rowIndex) => {
            const highlighted = focusKey !== null && row[focusKey] === focus?.value;
            return (
              <TableRow
                key={rowIndex}
                className={cn(
                  highlighted &&
                    "bg-[var(--color-primary)]/10 shadow-[inset_3px_0_0_var(--color-primary)] hover:bg-[var(--color-primary)]/15"
                )}
              >
                <TableCell className="text-right font-mono text-xs text-[var(--color-muted-foreground)]">
                  {rowIndex + 1}
                </TableCell>
                {table.columns.map((col) => {
                  const fk = table.foreignKeys.get(col.key);
                  const value = row[col.key] ?? null;
                  return (
                    <TableCell key={col.key}>
                      {fk ? (
                        <ForeignKeyCell
                          value={value}
                          fk={fk}
                          onFollow={() => onFollow(fk, value)}
                        />
                      ) : (
                        renderCell(value)
                      )}
                    </TableCell>
                  );
                })}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

// ============================================
// LivePreviewCanvas component
// ============================================

export default function LivePreviewCanvas({
  tables: tablesProp,
  columns = EMPTY_COLUMNS,
  activeTable: activeTableProp,
  rowCount = 8,
}: LivePreviewCanvasProps) {
  const [seed, setSeed] = useState<number>(() => randomSeed());
  const [view, setView] = useState<"table" | "erd">("table");
  // A manual pick only sticks until the designer opens a different table
  const [selection, setSelection] = useState<{ table: string; for?: string } | null>(null);
  const [focus, setFocus] = useState<RowFocus | null>(null);
  const selectedTable = selection?.for === activeTableProp ? selection?.table : undefined;

  const safeRowCount = Math.min(Math.max(1, rowCount), MAX_PREVIEW_ROWS);

  const specs = useMemo<PreviewTableSpec[]>(
    () => tablesProp ?? [{ name: "table", columns }],
    [tablesProp, columns]
  );

  const input = useMemo<PreviewInput>(
    () => ({ tables: specs, seed, rowCount: safeRowCount }),
    [specs, seed, safeRowCount]
  );

  // Deferred input keeps typing/slider drags responsive; it starts as null so the
  // first multi-table generation renders a skeleton instead of blocking the page
  const deferredInput = useDeferredValue<PreviewInput | null>(input, null);
  const isComputing = deferredInput !== input;

  const result = useMemo(
    () => (deferredInput ? buildPreview(deferredInput) : null),
    [deferredInput]
  );

  useEffect(() => {
    if (result?.error) {
      toast.error("Preview generation failed", { description: result.error });
    }
  }, [result?.error]);

  const tables = result?.tables ?? [];
  const activeTable =
    tables.find((t) => t.name === selectedTable) ??
    tables.find((t) => t.name === activeTableProp) ??
    tables[0];
  const isRelational = specs.length > 1;

  const erdTables = useMemo<ErdTable[]>(
    () =>
      (result?.tables ?? []).map((t) => ({
        name: t.name,
        depth: t.depth,
        rowCount: t.rows.length,
        columns: t.columns.map((c) => ({
          name: c.name,
          type: c.type,
          isPrimaryKey: c.isPrimaryKey,
          isUnique: c.isUnique,
          nullable: !c.isPrimaryKey && c.nullRate > 0,
        })),
      })),
    [result]
  );

  function handleRegenerate() {
    setSeed(randomSeed());
    setFocus(null);
  }

  function handleSelectTable(name: string) {
    setSelection({ table: name, for: activeTableProp });
    setFocus(null);
  }

  function handleFollow(fk: ResolvedForeignKey, value: CellValue) {
    setSelection({ table: fk.toTable, for: activeTableProp });
    setFocus({ table: fk.toTable, key: fk.toKey, value });
  }

  const hasColumns = specs.some((t) => t.columns.length > 0);

  return (
    <Card>
      <Tabs value={view} onValueChange={(v) => setView(v as "table" | "erd")}>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-4 space-y-0">
          <div className="flex flex-col gap-1.5">
            <CardTitle className="flex items-center gap-2 text-base">
              <TableProperties className="size-4" />
              Live Preview
              {isRelational && (
                <Badge variant="muted" className="text-[10px]">
                  {specs.length} tables
                </Badge>
              )}
              {isComputing && (
                <Loader2
                  className="size-3.5 animate-spin text-[var(--color-muted-foreground)]"
                  aria-label="Generating preview"
                />
              )}
            </CardTitle>
            <CardDescription>
              {hasColumns
                ? isRelational
                  ? `Linked sample rows (up to ${MAX_PREVIEW_ROWS} per table) · seed ${seed}`
                  : `${safeRowCount} sample rows · seed ${seed}`
                : "Sample rows appear here as you design your schema."}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <TabsList>
              <TabsTrigger value="table" className="gap-1.5">
                <TableProperties className="size-3.5" />
                Table View
              </TabsTrigger>
              <TabsTrigger value="erd" className="gap-1.5">
                <Network className="size-3.5" />
                ERD View
              </TabsTrigger>
            </TabsList>
            <Button
              variant="outline"
              size="sm"
              onClick={handleRegenerate}
              disabled={!hasColumns}
            >
              <RefreshCw className={cn(isComputing && "animate-spin")} />
              Regenerate
            </Button>
          </div>
        </CardHeader>

        <CardContent>
          {!hasColumns ? (
            <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-[var(--color-border)] py-10 text-sm text-[var(--color-muted-foreground)]">
              <TableProperties className="size-5 opacity-60" />
              Add columns to preview data.
            </div>
          ) : !result ? (
            <PreviewSkeleton />
          ) : result.error ? (
            <div className="flex items-start gap-3 rounded-md border border-[var(--color-destructive)] bg-[var(--color-destructive)]/10 p-4 text-sm text-[var(--color-destructive)]">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <div className="flex flex-col gap-2">
                <span>{result.error}</span>
                <button
                  className="self-start underline hover:no-underline"
                  onClick={handleRegenerate}
                >
                  Try again with a new seed
                </button>
              </div>
            </div>
          ) : (
            <div
              className={cn("transition-opacity", isComputing && "animate-pulse opacity-60")}
              aria-busy={isComputing}
            >
              <TabsContent value="table" className="mt-0 flex flex-col gap-3">
                {tables.length > 1 && (
                  <Tabs
                    value={activeTable?.name}
                    onValueChange={handleSelectTable}
                  >
                    <TabsList className="h-auto flex-wrap justify-start">
                      {tables.map((t) => (
                        <TabsTrigger key={t.name} value={t.name} className="gap-1.5 font-mono">
                          {t.name || "(unnamed)"}
                          {t.foreignKeys.size > 0 && (
                            <Link2
                              className="size-3 text-[var(--color-primary)]"
                              aria-label="Has foreign keys"
                            />
                          )}
                        </TabsTrigger>
                      ))}
                    </TabsList>
                  </Tabs>
                )}
                {activeTable && (
                  <PreviewTableView
                    table={activeTable}
                    focus={focus}
                    onFollow={handleFollow}
                    onSelectTable={handleSelectTable}
                  />
                )}
                {focus && focus.table === activeTable?.name && (
                  <p className="text-xs text-[var(--color-muted-foreground)]">
                    Highlighting the {focus.table} row linked from the previous table.{" "}
                    <button className="underline hover:no-underline" onClick={() => setFocus(null)}>
                      Clear
                    </button>
                  </p>
                )}
              </TabsContent>

              <TabsContent value="erd" className="mt-0">
                <ErdVisualizer
                  tables={erdTables}
                  relations={result.relations}
                  activeTable={activeTable?.name}
                  onSelectTable={(name) => {
                    handleSelectTable(name);
                    setView("table");
                  }}
                />
              </TabsContent>
            </div>
          )}
        </CardContent>
      </Tabs>
    </Card>
  );
}
