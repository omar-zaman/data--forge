"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { KeyRound, Link2, Network } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

// ============================================
// Types
// ============================================

export interface ErdColumn {
  name: string;
  type: string;
  isPrimaryKey?: boolean;
  isUnique?: boolean;
  nullable?: boolean;
}

export interface ErdTable {
  name: string;
  columns: ErdColumn[];
  /** Dependency depth: parents sit in columns left of their children. */
  depth: number;
  rowCount?: number;
}

export interface ErdRelation {
  fromTable: string;
  fromColumn: string;
  toTable: string;
  toColumn: string;
  /** Unique FK → one-to-one; otherwise one-to-many. */
  oneToOne?: boolean;
}

interface ErdVisualizerProps {
  tables: ErdTable[];
  relations: ErdRelation[];
  activeTable?: string;
  onSelectTable?: (name: string) => void;
}

interface EdgePath {
  id: string;
  d: string;
  active: boolean;
  oneToOne: boolean;
  label: string;
}

const anchorId = (table: string, column: string) => `${table}\u0000${column}`;

// ============================================
// Table card
// ============================================

interface TableCardProps {
  table: ErdTable;
  fkColumns: Map<string, ErdRelation>;
  active: boolean;
  onSelect?: () => void;
  registerAnchor: (id: string, el: HTMLElement) => () => void;
}

function TableCard({ table, fkColumns, active, onSelect, registerAnchor }: TableCardProps) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect?.();
        }
      }}
      className={cn(
        "relative z-10 w-60 cursor-pointer overflow-hidden rounded-lg border bg-[var(--color-background)] text-left shadow-sm transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]",
        active
          ? "border-[var(--color-primary)] ring-1 ring-[var(--color-primary)]"
          : "border-[var(--color-border)]"
      )}
      aria-label={`Show ${table.name} in table view`}
    >
      <div className="flex items-center justify-between gap-2 border-b border-[var(--color-border)] bg-[var(--color-muted)] px-3 py-2">
        <span className="truncate font-mono text-sm font-semibold">{table.name}</span>
        {table.rowCount !== undefined && (
          <Badge variant="muted" className="shrink-0 text-[10px]">
            {table.rowCount} rows
          </Badge>
        )}
      </div>
      <ul className="py-1">
        {table.columns.map((col, i) => {
          const fk = fkColumns.get(col.name);
          return (
            <li
              key={`${col.name}-${i}`}
              ref={(el) => (el ? registerAnchor(anchorId(table.name, col.name), el) : undefined)}
              className="flex items-center gap-2 px-3 py-1 text-xs"
              title={fk ? `References ${fk.toTable}.${fk.toColumn}` : undefined}
            >
              <span className="flex w-4 shrink-0 justify-center">
                {col.isPrimaryKey ? (
                  <KeyRound className="size-3 text-amber-500" aria-label="Primary key" />
                ) : fk ? (
                  <Link2 className="size-3 text-[var(--color-primary)]" aria-label="Foreign key" />
                ) : null}
              </span>
              <span
                className={cn(
                  "min-w-0 flex-1 truncate font-mono",
                  col.isPrimaryKey && "font-semibold",
                  !col.name && "italic text-[var(--color-muted-foreground)]"
                )}
              >
                {col.name || "unnamed"}
              </span>
              <span className="shrink-0 text-[10px] text-[var(--color-muted-foreground)]">
                {col.type}
                {col.isUnique && !col.isPrimaryKey && " · UQ"}
                {col.nullable && " · null"}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ============================================
// ErdVisualizer
// ============================================

/**
 * Lightweight entity-relationship diagram: tables laid out in columns by
 * dependency depth, with SVG connectors from each foreign key column to the
 * key it references (crow's foot on the "many" side).
 */
export default function ErdVisualizer({
  tables,
  relations,
  activeTable,
  onSelectTable,
}: ErdVisualizerProps) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const anchors = useRef(new Map<string, HTMLElement>());
  const [edges, setEdges] = useState<EdgePath[]>([]);
  const [size, setSize] = useState({ width: 0, height: 0 });

  const levels = useMemo(() => {
    const byDepth = new Map<number, ErdTable[]>();
    for (const table of tables) {
      byDepth.set(table.depth, [...(byDepth.get(table.depth) ?? []), table]);
    }
    return [...byDepth.entries()].sort(([a], [b]) => a - b).map(([, list]) => list);
  }, [tables]);

  const fkByTable = useMemo(() => {
    const map = new Map<string, Map<string, ErdRelation>>();
    for (const rel of relations) {
      const cols = map.get(rel.fromTable) ?? new Map<string, ErdRelation>();
      if (!cols.has(rel.fromColumn)) cols.set(rel.fromColumn, rel);
      map.set(rel.fromTable, cols);
    }
    return map;
  }, [relations]);

  function registerAnchor(id: string, el: HTMLElement) {
    // First column wins when a table briefly has duplicate names mid-edit
    if (!anchors.current.has(id)) anchors.current.set(id, el);
    return () => {
      if (anchors.current.get(id) === el) anchors.current.delete(id);
    };
  }

  // Re-measure connector geometry whenever the canvas or any card resizes
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const measure = () => {
      const origin = canvas.getBoundingClientRect();
      const next: EdgePath[] = [];

      relations.forEach((rel, i) => {
        const child = anchors.current.get(anchorId(rel.fromTable, rel.fromColumn));
        const parent = anchors.current.get(anchorId(rel.toTable, rel.toColumn));
        if (!child || !parent) return;

        const p = parent.getBoundingClientRect();
        const c = child.getBoundingClientRect();
        const x1 = p.right - origin.left;
        const y1 = p.top + p.height / 2 - origin.top;
        const x2 = c.left - origin.left;
        const y2 = c.top + c.height / 2 - origin.top;
        const bend = Math.max(32, Math.abs(x2 - x1) / 2);

        next.push({
          id: `${i}-${rel.fromTable}-${rel.fromColumn}`,
          d: `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`,
          active: rel.fromTable === activeTable || rel.toTable === activeTable,
          oneToOne: Boolean(rel.oneToOne),
          label: `${rel.fromTable}.${rel.fromColumn} → ${rel.toTable}.${rel.toColumn}`,
        });
      });

      setEdges(next);
      setSize({ width: canvas.scrollWidth, height: canvas.scrollHeight });
    };

    // ResizeObserver also fires once on observe, which performs the initial measure
    const observer = new ResizeObserver(measure);
    observer.observe(canvas);
    for (const el of anchors.current.values()) observer.observe(el);
    return () => observer.disconnect();
  }, [tables, relations, activeTable]);

  if (tables.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-[var(--color-border)] py-10 text-sm text-[var(--color-muted-foreground)]">
        <Network className="size-5 opacity-60" />
        Add tables to see their relationships.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-muted)]/40">
        <div ref={canvasRef} className="relative inline-flex min-w-full items-start gap-20 p-6">
          {levels.map((level, i) => (
            <div key={i} className="flex flex-col gap-6">
              {level.map((table) => (
                <TableCard
                  key={table.name}
                  table={table}
                  fkColumns={fkByTable.get(table.name) ?? new Map()}
                  active={table.name === activeTable}
                  onSelect={onSelectTable && (() => onSelectTable(table.name))}
                  registerAnchor={registerAnchor}
                />
              ))}
            </div>
          ))}

          <svg
            className="pointer-events-none absolute left-0 top-0 z-20 overflow-visible"
            width={size.width}
            height={size.height}
            aria-hidden
          >
            <defs>
              {(["active", "idle"] as const).map((tone) => {
                const stroke =
                  tone === "active" ? "var(--color-primary)" : "var(--color-muted-foreground)";
                return [
                  <marker
                    key={`one-${tone}`}
                    id={`erd-one-${tone}`}
                    viewBox="0 0 10 10"
                    refX="2"
                    refY="5"
                    markerWidth="10"
                    markerHeight="10"
                    orient="auto-start-reverse"
                  >
                    <path d="M 5 0 L 5 10" style={{ stroke, strokeWidth: 1.5, fill: "none" }} />
                  </marker>,
                  <marker
                    key={`many-${tone}`}
                    id={`erd-many-${tone}`}
                    viewBox="0 0 10 10"
                    refX="10"
                    refY="5"
                    markerWidth="10"
                    markerHeight="10"
                    orient="auto"
                  >
                    <path
                      d="M 0 5 L 10 0 M 0 5 L 10 5 M 0 5 L 10 10"
                      style={{ stroke, strokeWidth: 1.5, fill: "none" }}
                    />
                  </marker>,
                ];
              })}
            </defs>
            {edges.map((edge) => {
              const tone = edge.active ? "active" : "idle";
              return (
                <path
                  key={edge.id}
                  d={edge.d}
                  fill="none"
                  style={{
                    stroke: edge.active
                      ? "var(--color-primary)"
                      : "var(--color-muted-foreground)",
                    strokeWidth: edge.active ? 2 : 1.25,
                    opacity: edge.active ? 1 : 0.7,
                  }}
                  markerStart={`url(#erd-one-${tone})`}
                  markerEnd={`url(#erd-${edge.oneToOne ? "one" : "many"}-${tone})`}
                >
                  <title>{edge.label}</title>
                </path>
              );
            })}
          </svg>
        </div>
      </div>

      {relations.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {relations.map((rel, i) => (
            <Badge key={i} variant="outline" className="gap-1 font-mono text-[10px] font-normal">
              <Link2 className="size-3 text-[var(--color-primary)]" />
              {rel.fromTable}.{rel.fromColumn} → {rel.toTable}.{rel.toColumn}
              <span className="text-[var(--color-muted-foreground)]">
                {rel.oneToOne ? "1:1" : "N:1"}
              </span>
            </Badge>
          ))}
        </div>
      ) : (
        <p className="text-xs text-[var(--color-muted-foreground)]">
          No foreign keys yet — this schema has no relationships to draw.
        </p>
      )}
    </div>
  );
}
