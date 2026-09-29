import { Faker, base, en, type LocaleDefinition } from "@faker-js/faker";
import type { TableStructure } from "@/types/database";

// ============================================
// Types
// ============================================

export type CellValue = string | number | boolean | null;

/** Row keyed by EngineColumn.key */
export type GeneratedRow = Record<string, CellValue>;

export interface EngineColumn {
  key: string; // stable identifier used as the row key (e.g. UI row id or column name)
  name: string;
  type: string; // UIDataType string (e.g. "Email")
  nullRate: number; // 0–100
  isUnique?: boolean;
  isPrimaryKey?: boolean;
}

export interface GenerateOptions {
  columns: EngineColumn[];
  rowCount: number;
  seed?: number; // omit for non-deterministic output
  maxRows?: number; // hard cap; defaults to MAX_ROWS
  locale?: LocaleDefinition[]; // Faker locale chain; defaults to English
}

export class TabularEngineError extends Error {
  constructor(
    message: string,
    public readonly column?: string
  ) {
    super(message);
    this.name = "TabularEngineError";
  }
}

// ============================================
// Limits
// ============================================

export const MAX_PREVIEW_ROWS = 10;
const MAX_ROWS = 10_000;
const UNIQUE_RETRY_LIMIT = 50;

// ============================================
// Type → Faker mapping
// ============================================

type ValueGenerator = (f: Faker) => CellValue;

const GENERATORS: Record<string, ValueGenerator> = {
  Name: (f) => f.person.fullName(),
  FirstName: (f) => f.person.firstName(),
  LastName: (f) => f.person.lastName(),
  Email: (f) => f.internet.email().toLowerCase(),
  Phone: (f) => f.phone.number(),
  Address: (f) => f.location.streetAddress(),
  City: (f) => f.location.city(),
  Country: (f) => f.location.country(),
  ZipCode: (f) => f.location.zipCode(),
  Company: (f) => f.company.name(),
  JobTitle: (f) => f.person.jobTitle(),
  UUID: (f) => f.string.uuid(),
  Integer: (f) => f.number.int({ min: 0, max: 100_000 }),
  Float: (f) => f.number.float({ min: 0, max: 10_000, fractionDigits: 2 }),
  Boolean: (f) => f.datatype.boolean(),
  Date: (f) =>
    f.date
      .between({ from: "2015-01-01T00:00:00.000Z", to: "2025-12-31T00:00:00.000Z" })
      .toISOString()
      .slice(0, 10),
  DateTime: (f) =>
    f.date
      .between({ from: "2015-01-01T00:00:00.000Z", to: "2025-12-31T00:00:00.000Z" })
      .toISOString(),
  Text: (f) => f.lorem.sentence(),
  URL: (f) => f.internet.url(),
  IPAddress: (f) => f.internet.ipv4(),
};

export const SUPPORTED_TYPES = Object.keys(GENERATORS);

export function isSupportedType(type: string): boolean {
  return Object.prototype.hasOwnProperty.call(GENERATORS, type);
}

const DEFAULT_LOCALE: LocaleDefinition[] = [en, base];

// ============================================
// Seeding helpers
// ============================================

/** FNV-1a 32-bit hash — derives a stable per-column seed from the base seed. */
export function hashSeed(seed: number, key: string): number {
  let h = 0x811c9dc5 ^ (seed >>> 0);
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function randomSeed(): number {
  return Math.floor(Math.random() * 0xffffffff);
}

/**
 * Faker v8+ has no setLocale(); the locale chain is fixed per instance. Job
 * locale codes are resolved server-side with resolveFakerLocale() (engine/locale.ts).
 */
export function createFaker(
  seed: number,
  locale: LocaleDefinition[] = DEFAULT_LOCALE
): Faker {
  const f = new Faker({ locale });
  f.seed(seed);
  return f;
}

// ============================================
// Generator
// ============================================

export interface BatchGenerator {
  /** Generates the next `size` rows, continuing each column's value sequence. */
  next(size: number): GeneratedRow[];
}

/**
 * Stateful generator for backend batch processing. Each column keeps its own Faker
 * instance and uniqueness set across batches, so concatenated batches are identical
 * to a single generateRows() call with the same seed, regardless of batch size.
 */
export function createBatchGenerator(
  columns: EngineColumn[],
  seed: number = randomSeed(),
  locale?: LocaleDefinition[]
): BatchGenerator {
  const states = columns.map((col) => {
    const generate = GENERATORS[col.type];
    if (!generate) {
      throw new TabularEngineError(
        `Unsupported data type "${col.type}" for column "${col.name || "(unnamed)"}"`,
        col.name
      );
    }
    return {
      col,
      generate,
      f: createFaker(hashSeed(seed, `${col.key}:${col.type}`), locale),
      nullRate: col.isPrimaryKey
        ? 0
        : Math.min(Math.max(Number(col.nullRate) || 0, 0), 100) / 100,
      seen: col.isUnique || col.isPrimaryKey ? new Set<CellValue>() : null,
    };
  });

  return {
    next(size) {
      const count = Math.max(0, Math.floor(Number.isFinite(size) ? size : 0));
      const rows: GeneratedRow[] = Array.from({ length: count }, () => ({}));
      if (count === 0) return rows;

      for (const { col, generate, f, nullRate, seen } of states) {
        for (let i = 0; i < count; i++) {
          // Always consume the null roll so the value sequence is stable across null-rate changes
          const isNull = f.number.float({ min: 0, max: 1 }) < nullRate;
          let value = generate(f);

          if (seen) {
            let attempts = 0;
            while (seen.has(value) && attempts < UNIQUE_RETRY_LIMIT) {
              value = generate(f);
              attempts++;
            }
            if (seen.has(value)) {
              throw new TabularEngineError(
                `Could not generate enough unique values for column "${col.name || "(unnamed)"}" (${col.type})`,
                col.name
              );
            }
            seen.add(value);
          }

          rows[i][col.key] = isNull ? null : value;
        }
      }

      return rows;
    },
  };
}

/**
 * Generates rows column-by-column. Each column gets its own Faker instance seeded
 * from (seed, column key + type), so editing one column never reshuffles the others,
 * and the same seed always yields the same output.
 */
export function generateRows({
  columns,
  rowCount,
  seed = randomSeed(),
  maxRows = MAX_ROWS,
  locale,
}: GenerateOptions): GeneratedRow[] {
  const count = Math.max(
    0,
    Math.min(Math.floor(Number.isFinite(rowCount) ? rowCount : 0), maxRows)
  );
  if (count === 0 || columns.length === 0) {
    return Array.from({ length: count }, () => ({}));
  }
  return createBatchGenerator(columns, seed, locale).next(count);
}

/** Preview-safe wrapper: hard-capped at MAX_PREVIEW_ROWS. */
export function generatePreviewRows(
  columns: EngineColumn[],
  seed: number,
  rowCount: number = MAX_PREVIEW_ROWS
): GeneratedRow[] {
  return generateRows({
    columns,
    seed,
    rowCount: Math.min(rowCount, MAX_PREVIEW_ROWS),
    maxRows: MAX_PREVIEW_ROWS,
  });
}

/** Maps a stored TableStructure (schema BSON/JSON) to engine columns keyed by column name. */
export function tableStructureToEngineColumns(
  table: TableStructure
): EngineColumn[] {
  const nullRates = table.nullRates ?? {};
  return table.columns.map((col) => ({
    key: col.name,
    name: col.name,
    type: col.type,
    nullRate: nullRates[col.name] ?? 0,
    isUnique: col.constraints?.some((c) => c.type === "UNIQUE") ?? false,
    isPrimaryKey: col.primaryKey ?? false,
  }));
}

/** Convenience: generate rows directly from a stored TableStructure. */
export function generateFromTableStructure(
  table: TableStructure,
  rowCount: number,
  seed?: number
): GeneratedRow[] {
  return generateRows({
    columns: tableStructureToEngineColumns(table),
    rowCount,
    seed,
  });
}
