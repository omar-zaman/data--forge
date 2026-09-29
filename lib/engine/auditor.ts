/**
 * Post-generation data auditor ("health checks").
 *
 * Runs in memory while a job's rows stream through the worker, so a table
 * never has to be held in full: rows are observed batch by batch and only the
 * values of key columns (primary keys, unique columns – which include every FK
 * target) are retained.
 *
 * Checks:
 *   1. Referential integrity – every non-null FK value exists in the parent's key column
 *   2. Null rates            – actual null % per column vs. the configured rate
 *   3. Uniqueness            – primary key / unique columns hold no duplicates (or PK nulls)
 *
 * A report passes when it has no ERROR issues; warnings are acceptable.
 */

import type { CellValue, GeneratedRow } from "@/lib/engine/tabular-engine";
import type { PlannedTable } from "@/lib/engine/relational-engine";

// ============================================
// Types
// ============================================

export type AuditIssueType = "WARNING" | "ERROR";

export type AuditCheck =
  | "REFERENTIAL_INTEGRITY"
  | "NULL_RATE"
  | "UNIQUENESS"
  | "EMPTY_TABLE";

export interface AuditIssue {
  table: string;
  column: string;
  type: AuditIssueType;
  check: AuditCheck;
  message: string;
  /** Rows affected by the issue. */
  count?: number;
  /** 1-based row numbers (within the table) of the first offending rows. */
  sampleRows?: number[];
  /** String forms of the first offending values. */
  sampleValues?: string[];
}

export interface ColumnAuditStats {
  table: string;
  column: string;
  rows: number;
  nulls: number;
  /** Percentages, 0–100, rounded to 2 decimals. */
  actualNullRate: number;
  expectedNullRate: number;
  isPrimaryKey: boolean;
  isUnique: boolean;
  /** Set for FK columns: "parent.column". */
  references?: string;
}

export interface AuditSummary {
  passed: boolean;
  tablesChecked: number;
  rowsChecked: number;
  errorCount: number;
  warningCount: number;
  checks: Record<Exclude<AuditCheck, "EMPTY_TABLE">, { columnsChecked: number; violations: number }>;
  columns: ColumnAuditStats[];
  auditedAt: string;
  durationMs: number;
}

export interface AuditReport {
  passed: boolean;
  issues: AuditIssue[];
  summary: AuditSummary;
}

export interface DatasetAuditor {
  /** Feeds the next batch of `table`'s rows (tables must arrive in dependency order). */
  observe(table: string, rows: GeneratedRow[]): void;
  /** Evaluates all checks and returns the report. */
  finalize(): AuditReport;
}

// ============================================
// Tunables
// ============================================

const SAMPLE_LIMIT = 5;
/** Null-rate drift below this many percentage points is never reported. */
const NULL_RATE_MIN_TOLERANCE = 2;
/** Otherwise drift is reported beyond this many binomial standard deviations. */
const NULL_RATE_SIGMAS = 4;

// ============================================
// Helpers
// ============================================

const isNull = (value: CellValue | undefined): value is null | undefined =>
  value === null || value === undefined;

const round2 = (n: number) => Math.round(n * 100) / 100;

function pct(part: number, whole: number): number {
  return whole === 0 ? 0 : round2((part / whole) * 100);
}

function expectedNullRate(col: { nullRate: number; isPrimaryKey?: boolean }): number {
  return col.isPrimaryKey ? 0 : Math.min(Math.max(Number(col.nullRate) || 0, 0), 100);
}

function formatValue(value: CellValue): string {
  const text = typeof value === "string" ? value : String(value);
  return text.length > 60 ? `${text.slice(0, 57)}…` : text;
}

/** Collects the first few offending rows/values of an issue. */
class Sampler {
  count = 0;
  rows: number[] = [];
  values: string[] = [];

  add(row: number, value?: CellValue) {
    this.count++;
    if (this.rows.length < SAMPLE_LIMIT) {
      this.rows.push(row);
      if (value !== undefined) this.values.push(formatValue(value));
    }
  }

  toIssueFields(): Pick<AuditIssue, "count" | "sampleRows" | "sampleValues"> {
    return {
      count: this.count,
      sampleRows: this.rows,
      ...(this.values.length > 0 && { sampleValues: this.values }),
    };
  }
}

interface ColumnState {
  key: string;
  name: string;
  expectedNullRate: number;
  isPrimaryKey: boolean;
  isUnique: boolean;
  nulls: number;
  /** Seen values; only kept for key columns. */
  seen?: Set<CellValue>;
  duplicates?: Sampler;
  pkNulls?: Sampler;
  unexpectedNulls?: Sampler;
  fk?: { toTable: string; toColumn: string; toKey: string; broken: Sampler };
}

interface TableState {
  name: string;
  rows: number;
  columns: ColumnState[];
}

// ============================================
// Auditor
// ============================================

/**
 * Creates a streaming auditor for a planned relational schema. Feed every
 * generated batch through `observe`, then call `finalize` once.
 */
export function createDatasetAuditor(tables: PlannedTable[]): DatasetAuditor {
  const startedAt = Date.now();
  const states = new Map<string, TableState>();

  for (const table of tables) {
    const fkByKey = new Map(table.foreignKeys.map((fk) => [fk.fromKey, fk]));
    states.set(table.name, {
      name: table.name,
      rows: 0,
      columns: table.columns.map((col): ColumnState => {
        const isKey = Boolean(col.isPrimaryKey || col.isUnique);
        const fk = fkByKey.get(col.key);
        const expected = expectedNullRate(col);
        return {
          key: col.key,
          name: col.name,
          expectedNullRate: expected,
          isPrimaryKey: Boolean(col.isPrimaryKey),
          isUnique: Boolean(col.isUnique),
          nulls: 0,
          ...(isKey && { seen: new Set<CellValue>(), duplicates: new Sampler() }),
          ...(col.isPrimaryKey && { pkNulls: new Sampler() }),
          ...(expected === 0 && !col.isPrimaryKey && { unexpectedNulls: new Sampler() }),
          ...(fk && {
            fk: {
              toTable: fk.toTable,
              toColumn: fk.toColumn,
              toKey: fk.toKey,
              broken: new Sampler(),
            },
          }),
        };
      }),
    });
  }

  /** Values of a parent's key column (every FK target is a PK or unique column). */
  const parentKeys = (tableName: string, key: string): Set<CellValue> | undefined =>
    states.get(tableName)?.columns.find((c) => c.key === key)?.seen;

  return {
    observe(tableName, rows) {
      const table = states.get(tableName);
      if (!table) throw new Error(`Auditor received rows for unknown table "${tableName}"`);

      for (const col of table.columns) {
        const parent = col.fk ? parentKeys(col.fk.toTable, col.fk.toKey) : undefined;

        for (let i = 0; i < rows.length; i++) {
          const rowNumber = table.rows + i + 1;
          const value = rows[i][col.key];

          if (isNull(value)) {
            col.nulls++;
            col.pkNulls?.add(rowNumber);
            col.unexpectedNulls?.add(rowNumber);
            continue;
          }

          if (col.seen) {
            if (col.seen.has(value)) col.duplicates!.add(rowNumber, value);
            else col.seen.add(value);
          }

          if (col.fk && !parent?.has(value)) col.fk.broken.add(rowNumber, value);
        }
      }

      table.rows += rows.length;
    },

    finalize() {
      const issues: AuditIssue[] = [];
      const columns: ColumnAuditStats[] = [];
      const checks: AuditSummary["checks"] = {
        REFERENTIAL_INTEGRITY: { columnsChecked: 0, violations: 0 },
        NULL_RATE: { columnsChecked: 0, violations: 0 },
        UNIQUENESS: { columnsChecked: 0, violations: 0 },
      };
      let rowsChecked = 0;

      for (const table of states.values()) {
        rowsChecked += table.rows;

        if (table.rows === 0) {
          issues.push({
            table: table.name,
            column: "*",
            type: "WARNING",
            check: "EMPTY_TABLE",
            message: `Table "${table.name}" produced no rows.`,
            count: 0,
          });
        }

        for (const col of table.columns) {
          const label = `${table.name}.${col.name}`;
          const actual = pct(col.nulls, table.rows);
          columns.push({
            table: table.name,
            column: col.name,
            rows: table.rows,
            nulls: col.nulls,
            actualNullRate: actual,
            expectedNullRate: col.expectedNullRate,
            isPrimaryKey: col.isPrimaryKey,
            isUnique: col.isUnique,
            ...(col.fk && { references: `${col.fk.toTable}.${col.fk.toColumn}` }),
          });

          // ---- Check 1: referential integrity
          if (col.fk) {
            checks.REFERENTIAL_INTEGRITY.columnsChecked++;
            const { broken } = col.fk;
            if (broken.count > 0) {
              checks.REFERENTIAL_INTEGRITY.violations += broken.count;
              issues.push({
                table: table.name,
                column: col.name,
                type: "ERROR",
                check: "REFERENTIAL_INTEGRITY",
                message: `${broken.count.toLocaleString()} value(s) in ${label} have no matching row in ${col.fk.toTable}.${col.fk.toColumn}.`,
                ...broken.toIssueFields(),
              });
            }
          }

          // ---- Check 2: null rates
          if (table.rows > 0) {
            checks.NULL_RATE.columnsChecked++;
            if (col.pkNulls && col.pkNulls.count > 0) {
              checks.NULL_RATE.violations++;
              issues.push({
                table: table.name,
                column: col.name,
                type: "ERROR",
                check: "NULL_RATE",
                message: `Primary key ${label} contains ${col.pkNulls.count.toLocaleString()} null value(s).`,
                ...col.pkNulls.toIssueFields(),
              });
            } else if (col.unexpectedNulls && col.unexpectedNulls.count > 0) {
              checks.NULL_RATE.violations++;
              issues.push({
                table: table.name,
                column: col.name,
                type: "ERROR",
                check: "NULL_RATE",
                message: `${label} is configured as non-nullable but ${actual}% of rows (${col.unexpectedNulls.count.toLocaleString()}) are null.`,
                ...col.unexpectedNulls.toIssueFields(),
              });
            } else if (col.expectedNullRate > 0) {
              const p = col.expectedNullRate / 100;
              const sigma = Math.sqrt((p * (1 - p)) / table.rows) * 100;
              const tolerance = Math.max(NULL_RATE_MIN_TOLERANCE, NULL_RATE_SIGMAS * sigma);
              const drift = round2(actual - col.expectedNullRate);
              if (Math.abs(drift) > tolerance) {
                checks.NULL_RATE.violations++;
                issues.push({
                  table: table.name,
                  column: col.name,
                  type: "WARNING",
                  check: "NULL_RATE",
                  message: `${label} is ${actual}% null but configured for ${col.expectedNullRate}% (${drift > 0 ? "+" : ""}${drift} pts, tolerance ±${round2(tolerance)}).`,
                  count: col.nulls,
                });
              }
            }
          }

          // ---- Check 3: uniqueness
          if (col.duplicates) {
            checks.UNIQUENESS.columnsChecked++;
            if (col.duplicates.count > 0) {
              checks.UNIQUENESS.violations += col.duplicates.count;
              issues.push({
                table: table.name,
                column: col.name,
                type: "ERROR",
                check: "UNIQUENESS",
                message: `${col.isPrimaryKey ? "Primary key" : "Unique column"} ${label} has ${col.duplicates.count.toLocaleString()} duplicate value(s).`,
                ...col.duplicates.toIssueFields(),
              });
            }
          }
        }
      }

      // Errors first, then by table/column
      issues.sort(
        (a, b) =>
          (a.type === b.type ? 0 : a.type === "ERROR" ? -1 : 1) ||
          a.table.localeCompare(b.table) ||
          a.column.localeCompare(b.column)
      );

      const errorCount = issues.filter((i) => i.type === "ERROR").length;
      const warningCount = issues.length - errorCount;
      const passed = errorCount === 0;

      // Release the key sets as soon as the report is built
      for (const table of states.values()) {
        for (const col of table.columns) col.seen?.clear();
      }

      return {
        passed,
        issues,
        summary: {
          passed,
          tablesChecked: states.size,
          rowsChecked,
          errorCount,
          warningCount,
          checks,
          columns,
          auditedAt: new Date().toISOString(),
          durationMs: Date.now() - startedAt,
        },
      };
    },
  };
}

/**
 * Audits a fully materialized dataset (rows keyed by table name). Tables are
 * visited in the plan's dependency order. Prefer `createDatasetAuditor` for
 * large jobs so rows can be audited batch by batch.
 */
export function auditDataset(
  schema: PlannedTable[],
  data: Record<string, GeneratedRow[]>
): AuditReport {
  const auditor = createDatasetAuditor(schema);
  for (const table of schema) auditor.observe(table.name, data[table.name] ?? []);
  return auditor.finalize();
}
