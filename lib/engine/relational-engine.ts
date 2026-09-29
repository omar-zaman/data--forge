import type { LocaleDefinition } from "@faker-js/faker";
import type {
  CardinalityConstraint,
  ForeignKeyConstraint,
  TableStructure,
} from "@/types/database";
import {
  MAX_PREVIEW_ROWS,
  TabularEngineError,
  createBatchGenerator,
  createFaker,
  hashSeed,
  tableStructureToEngineColumns,
  type CellValue,
  type EngineColumn,
  type GeneratedRow,
} from "@/lib/engine/tabular-engine";

// ============================================
// Types
// ============================================

/**
 * Foreign key input. Columns are matched by EngineColumn.key when `fromKey` /
 * `toKey` are given (the designer passes stable row ids, so half-typed names
 * never break a link), otherwise by column name.
 */
export interface RelationalForeignKeyInput extends ForeignKeyConstraint {
  fromKey?: string;
  toKey?: string;
}

export interface RelationalTableInput {
  name: string;
  columns: EngineColumn[];
  foreignKeys?: RelationalForeignKeyInput[];
  /** Keyed by FK column name, as stored on TableStructure. */
  cardinalities?: Record<string, CardinalityConstraint>;
}

/** A foreign key resolved to engine column keys. */
export interface ResolvedForeignKey {
  fromColumn: string; // column name in the child table
  fromKey: string; // EngineColumn.key in the child table
  toTable: string;
  toColumn: string; // column name in the parent table
  toKey: string; // EngineColumn.key in the parent table
  onDelete?: ForeignKeyConstraint["onDelete"];
  onUpdate?: ForeignKeyConstraint["onUpdate"];
}

/** Rows-per-parent rule that sizes a child table. */
export interface DrivingRelation {
  fk: ResolvedForeignKey;
  min: number;
  max: number;
}

export interface PlannedTable {
  /** Position in the original tables array (keeps per-table seeds stable). */
  index: number;
  name: string;
  columns: EngineColumn[];
  foreignKeys: ResolvedForeignKey[];
  /**
   * The first FK with a cardinality: every parent row gets min–max children,
   * so the child's row count follows its parent instead of the job row count.
   */
  driver: DrivingRelation | null;
  /** 0 for tables without foreign keys, else 1 + the deepest parent's depth. */
  depth: number;
  /** Column keys whose values child tables sample from. */
  pooledKeys: string[];
}

export interface RelationalPlan {
  /** Tables in dependency order: every parent precedes its children. */
  tables: PlannedTable[];
}

/** Generated key values, keyed by poolId(table, columnKey). Nulls are never pooled. */
export type KeyPools = Map<string, CellValue[]>;

export const poolId = (table: string, key: string) => `${table}\u0000${key}`;

/** Upper bound for "max rows per parent" so one parent can't explode a table. */
const MAX_CHILDREN_PER_PARENT = 1_000;

// ============================================
// Planning
// ============================================

function resolveDriver(
  table: RelationalTableInput,
  fks: ResolvedForeignKey[]
): DrivingRelation | null {
  for (const fk of fks) {
    const card = table.cardinalities?.[fk.fromColumn];
    if (!card) continue;
    if (card.relationship === "oneToOne") return { fk, min: 1, max: 1 };

    const clamp = (n: unknown, fallback: number) =>
      Math.min(
        Math.max(Math.floor(Number.isFinite(Number(n)) ? Number(n) : fallback), 0),
        MAX_CHILDREN_PER_PARENT
      );
    const min = clamp(card.minRecords, 1);
    const max = Math.max(min, clamp(card.maxRecords, min));
    // A unique FK column can hold each parent key at most once
    const col = table.columns.find((c) => c.key === fk.fromKey);
    if (col?.isUnique || col?.isPrimaryKey) return { fk, min: Math.min(min, 1), max: 1 };
    return { fk, min, max };
  }
  return null;
}

/**
 * Validates foreign keys and orders tables so every parent is generated (and
 * inserted) before its children. Throws TabularEngineError on dangling
 * references, self references or cycles.
 */
export function planRelationalSchema(tables: RelationalTableInput[]): RelationalPlan {
  const byName = new Map<string, number>();
  tables.forEach((t, i) => {
    if (byName.has(t.name)) {
      throw new TabularEngineError(`Duplicate table name "${t.name || "(unnamed)"}"`);
    }
    byName.set(t.name, i);
  });

  const findColumn = (columns: EngineColumn[], key: string | undefined, name: string) =>
    key !== undefined
      ? columns.find((c) => c.key === key)
      : columns.find((c) => c.name === name);

  const resolved: ResolvedForeignKey[][] = tables.map((table) => {
    const seenFrom = new Set<string>();
    return (table.foreignKeys ?? []).map((fk) => {
      const from = findColumn(table.columns, fk.fromKey, fk.fromColumn);
      const label = `${table.name}.${from?.name ?? fk.fromColumn}`;
      if (!from) {
        throw new TabularEngineError(`Foreign key column "${label}" does not exist`, fk.fromColumn);
      }
      if (seenFrom.has(from.key)) {
        throw new TabularEngineError(`Column "${label}" has more than one foreign key`, from.name);
      }
      seenFrom.add(from.key);

      if (fk.toTable === table.name) {
        throw new TabularEngineError(
          `Self-referencing foreign key "${label}" is not supported`,
          from.name
        );
      }
      const parentIndex = byName.get(fk.toTable);
      if (parentIndex === undefined) {
        throw new TabularEngineError(
          `Foreign key "${label}" references unknown table "${fk.toTable}"`,
          from.name
        );
      }
      const to = findColumn(tables[parentIndex].columns, fk.toKey, fk.toColumn);
      if (!to) {
        throw new TabularEngineError(
          `Foreign key "${label}" references unknown column "${fk.toTable}.${fk.toColumn}"`,
          from.name
        );
      }
      // SQL only allows references to keys, and uniqueness keeps sampled values valid
      if (!to.isPrimaryKey && !to.isUnique) {
        throw new TabularEngineError(
          `Foreign key "${label}" must reference a primary key or unique column ("${fk.toTable}.${to.name}" is neither)`,
          from.name
        );
      }

      return {
        fromColumn: from.name,
        fromKey: from.key,
        toTable: fk.toTable,
        toColumn: to.name,
        toKey: to.key,
        onDelete: fk.onDelete,
        onUpdate: fk.onUpdate,
      };
    });
  });

  // Kahn's algorithm; ties keep the original table order
  const parents = resolved.map((fks) => new Set(fks.map((fk) => byName.get(fk.toTable)!)));
  const depth = new Array<number>(tables.length).fill(0);
  const done = new Set<number>();
  const order: number[] = [];

  while (order.length < tables.length) {
    const next = tables.findIndex(
      (_, i) => !done.has(i) && [...parents[i]].every((p) => done.has(p))
    );
    if (next === -1) {
      const stuck = tables.filter((_, i) => !done.has(i)).map((t) => t.name);
      throw new TabularEngineError(
        `Circular foreign key references between tables: ${stuck.join(", ")}`
      );
    }
    depth[next] = Math.max(-1, ...[...parents[next]].map((p) => depth[p])) + 1;
    done.add(next);
    order.push(next);
  }

  const pooled = tables.map(() => new Set<string>());
  resolved.flat().forEach((fk) => pooled[byName.get(fk.toTable)!].add(fk.toKey));

  return {
    tables: order.map((i) => ({
      index: i,
      name: tables[i].name,
      columns: tables[i].columns,
      foreignKeys: resolved[i],
      driver: resolveDriver(tables[i], resolved[i]),
      depth: depth[i],
      pooledKeys: [...pooled[i]],
    })),
  };
}

// ============================================
// Generation
// ============================================

function clampNullRate(col: EngineColumn): number {
  return col.isPrimaryKey
    ? 0
    : Math.min(Math.max(Number(col.nullRate) || 0, 0), 100) / 100;
}

function getPool(pools: KeyPools, table: string, key: string): CellValue[] {
  return pools.get(poolId(table, key)) ?? [];
}

/** Draws FK values at random from the parent's generated keys. */
function createForeignKeySampler(
  table: PlannedTable,
  fk: ResolvedForeignKey,
  pools: KeyPools,
  seed: number
): () => CellValue {
  const col = table.columns.find((c) => c.key === fk.fromKey)!;
  const label = `${table.name}.${fk.fromColumn}`;
  const pool = getPool(pools, fk.toTable, fk.toKey);
  const f = createFaker(hashSeed(seed, `fk:${fk.fromKey}`));
  const nullRate = clampNullRate(col);
  const unique = col.isUnique || col.isPrimaryKey;

  // Unique FKs draw parent keys without replacement from a shuffled copy
  let shuffled: CellValue[] | null = null;
  let cursor = 0;

  return () => {
    // Always consume the null roll so the value sequence is stable across null-rate changes
    const isNull = f.number.float({ min: 0, max: 1 }) < nullRate;
    if (isNull) return null;

    if (pool.length === 0) {
      throw new TabularEngineError(
        `Cannot fill "${label}": parent table "${fk.toTable}" has no "${fk.toColumn}" values`,
        fk.fromColumn
      );
    }
    if (!unique) return pool[f.number.int({ min: 0, max: pool.length - 1 })];

    shuffled ??= f.helpers.shuffle(pool.slice());
    if (cursor >= shuffled.length) {
      throw new TabularEngineError(
        `Cannot fill unique column "${label}": "${fk.toTable}" has only ${shuffled.length} rows to link to`,
        fk.fromColumn
      );
    }
    return shuffled[cursor++];
  };
}

/**
 * Assigns children to parents in order: parent i gets counts[i] rows (min–max),
 * truncated once `maxRows` is reached.
 */
function planDrivenRows(
  driver: DrivingRelation,
  pool: CellValue[],
  seed: number,
  maxRows: number
): { counts: Uint32Array; total: number } {
  const f = createFaker(hashSeed(seed, `card:${driver.fk.fromKey}`));
  const counts = new Uint32Array(pool.length);
  let total = 0;
  for (let i = 0; i < pool.length && total < maxRows; i++) {
    const n = Math.min(f.number.int({ min: driver.min, max: driver.max }), maxRows - total);
    counts[i] = n;
    total += n;
  }
  return { counts, total };
}

export interface RelationalTableGenerator {
  /** Rows this table will produce in total (known up front). */
  readonly rowCount: number;
  /** Generates the next `size` rows (never beyond rowCount). */
  next(size: number): GeneratedRow[];
}

/**
 * Generator for one planned table. Regular columns come from the tabular
 * engine; FK columns take values from the parent's generated keys, so every
 * reference points at a row that exists. A table with a driving relation gets
 * min–max rows per parent; other tables get `rowCount` rows. Keys children
 * reference are appended to `pools` as rows are generated.
 */
export function createRelationalTableGenerator(
  table: PlannedTable,
  pools: KeyPools,
  seed: number,
  {
    rowCount,
    maxRows,
    locale,
  }: { rowCount: number; maxRows: number; locale?: LocaleDefinition[] }
): RelationalTableGenerator {
  const fkKeys = new Set(table.foreignKeys.map((fk) => fk.fromKey));
  // Column seeds hash on the column key, so skipping FK columns never shifts the others
  const base = createBatchGenerator(
    table.columns.filter((c) => !fkKeys.has(c.key)),
    seed,
    locale
  );

  const { driver } = table;
  const samplers = table.foreignKeys
    .filter((fk) => fk !== driver?.fk)
    .map((fk) => ({ key: fk.fromKey, next: createForeignKeySampler(table, fk, pools, seed) }));

  let total = Math.max(0, Math.min(Math.floor(rowCount) || 0, maxRows));
  let driverPool: CellValue[] = [];
  let counts: Uint32Array | null = null;
  if (driver) {
    driverPool = getPool(pools, driver.fk.toTable, driver.fk.toKey);
    ({ counts, total } = planDrivenRows(driver, driverPool, seed, maxRows));
  }

  const ownPools = table.pooledKeys.map((key) => {
    const id = poolId(table.name, key);
    const pool = pools.get(id) ?? [];
    pools.set(id, pool);
    return { key, pool };
  });

  let produced = 0;
  let parentIndex = 0;
  let parentRemaining = counts?.[0] ?? 0;

  return {
    rowCount: total,

    next(size) {
      const count = Math.max(0, Math.min(Math.floor(size) || 0, total - produced));
      const rows = base.next(count);

      if (driver && counts) {
        for (const row of rows) {
          while (parentRemaining === 0) parentRemaining = counts[++parentIndex];
          row[driver.fk.fromKey] = driverPool[parentIndex];
          parentRemaining--;
        }
      }
      for (const sampler of samplers) {
        for (const row of rows) row[sampler.key] = sampler.next();
      }
      for (const { key, pool } of ownPools) {
        for (const row of rows) {
          const value = row[key];
          if (value !== null && value !== undefined) pool.push(value);
        }
      }

      produced += count;
      return rows;
    },
  };
}

/** Per-table seed; offset by the table's original position so identical tables differ. */
export function tableSeed(baseSeed: number, table: PlannedTable): number {
  return (baseSeed + table.index) >>> 0;
}

// ============================================
// Preview
// ============================================

export interface RelationalPreview {
  plan: RelationalPlan;
  rows: Record<string, GeneratedRow[]>;
}

/** Generates a small linked sample of every table (hard-capped at MAX_PREVIEW_ROWS each). */
export function generateRelationalPreview(
  tables: RelationalTableInput[],
  seed: number,
  rowCount: number = MAX_PREVIEW_ROWS
): RelationalPreview {
  const plan = planRelationalSchema(tables);
  const pools: KeyPools = new Map();
  const rows: Record<string, GeneratedRow[]> = {};

  for (const table of plan.tables) {
    const generator = createRelationalTableGenerator(table, pools, tableSeed(seed, table), {
      rowCount,
      maxRows: MAX_PREVIEW_ROWS,
    });
    rows[table.name] = generator.next(generator.rowCount);
  }
  return { plan, rows };
}

/** Maps stored TableStructures to relational engine inputs keyed by column name. */
export function tableStructuresToRelationalInput(
  tables: TableStructure[]
): RelationalTableInput[] {
  return tables.map((t) => ({
    name: t.name,
    columns: tableStructureToEngineColumns(t),
    foreignKeys: t.foreignKeys ?? [],
    cardinalities: t.cardinalities,
  }));
}
