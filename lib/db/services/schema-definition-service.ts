/**
 * SchemaDefinitionService
 * CRUD, validation, JSON serialization, and versioning for SchemaDefinition records.
 */

import prisma from "@/lib/db/prisma";
import type {
  SchemaDefinition,
  CreateSchemaDefinitionInput,
  UpdateSchemaDefinitionInput,
  TableStructure,
  ColumnDefinition,
  ForeignKeyConstraint,
} from "@/types/database";
import { DataType } from "@/types/database";
import { Prisma } from "@prisma/client";

// ============================================
// Validation helpers
// ============================================

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
}

/**
 * Validates an array of TableStructure objects.
 *
 * Rules enforced:
 *  1. Each table must have a non-empty `name`.
 *  2. Each table must have at least one column.
 *  3. Each table must have exactly one primary-key column.
 *  4. Every foreign-key `toTable` reference must point to a table that
 *     exists in the same `tables` array.
 */
export function validateTableStructure(
  tables: TableStructure[]
): ValidationResult {
  const errors: string[] = [];

  if (!Array.isArray(tables)) {
    return { isValid: false, errors: ["tables must be an array"] };
  }

  const tableNames = new Set(tables.map((t) => t.name));

  for (let i = 0; i < tables.length; i++) {
    const table = tables[i];
    const prefix = `Table[${i}]${table?.name ? ` ("${table.name}")` : ""}`;

    // Rule 1 – must have a name
    if (!table.name || table.name.trim() === "") {
      errors.push(`${prefix}: table must have a non-empty name`);
    }

    // Rule 2 – must have at least one column
    if (!Array.isArray(table.columns) || table.columns.length === 0) {
      errors.push(`${prefix}: table must have at least one column`);
      // Skip further column checks when there are no columns
      continue;
    }

    // Rule 3 – exactly one primary key
    const pkColumns = table.columns.filter((c: ColumnDefinition) => c.primaryKey === true);
    if (pkColumns.length === 0) {
      errors.push(`${prefix}: table must have exactly one primary key column`);
    } else if (pkColumns.length > 1) {
      errors.push(
        `${prefix}: table must have exactly one primary key column (found ${pkColumns.length}: ${pkColumns.map((c) => c.name).join(", ")})`
      );
    }

    // Rule 4 – foreign key toTable references must exist
    if (Array.isArray(table.foreignKeys)) {
      for (const fk of table.foreignKeys as ForeignKeyConstraint[]) {
        if (fk.toTable && !tableNames.has(fk.toTable)) {
          errors.push(
            `${prefix}: foreign key references unknown table "${fk.toTable}"`
          );
        }
      }
    }
  }

  return { isValid: errors.length === 0, errors };
}

// ============================================
// JSON serialisation helpers
// ============================================

/**
 * Deserializes a raw Prisma `Json` value into a typed `TableStructure[]`.
 * Returns an empty array when the input is null / undefined / not an array.
 */
export function parseTables(tablesJson: unknown): TableStructure[] {
  if (!tablesJson || !Array.isArray(tablesJson)) {
    return [];
  }
  // Cast: Prisma stores Json as Prisma.JsonValue; we trust the shape here.
  return tablesJson as unknown as TableStructure[];
}

/**
 * Serializes a `TableStructure[]` into a value that Prisma accepts for a
 * `Json` field.  Returns the array cast to `Prisma.InputJsonValue`.
 */
export function formatTables(tables: TableStructure[]): Prisma.InputJsonValue {
  return tables as unknown as Prisma.InputJsonValue;
}

// ============================================
// CRUD operations
// ============================================

export async function createSchema(
  workspaceId: string,
  name: string,
  dataType: DataType,
  tables: TableStructure[] = [],
  version: number = 1
): Promise<SchemaDefinition> {
  const validation = validateTableStructure(tables);
  if (!validation.isValid) {
    throw new Error(
      `Invalid table structure: ${validation.errors.join("; ")}`
    );
  }

  return prisma.schemaDefinition.create({
    data: {
      workspaceId,
      name,
      dataType,
      tables: formatTables(tables),
      version,
    },
  });
}

export async function getSchema(id: string): Promise<SchemaDefinition | null> {
  return prisma.schemaDefinition.findUnique({
    where: { id },
  });
}

export async function listSchemas(
  workspaceId: string
): Promise<SchemaDefinition[]> {
  return prisma.schemaDefinition.findMany({
    where: { workspaceId },
    orderBy: [{ name: "asc" }, { version: "desc" }],
  });
}

export async function updateSchema(
  id: string,
  data: Partial<{
    name: string;
    dataType: DataType;
    tables: TableStructure[];
  }>
): Promise<SchemaDefinition> {
  const updatePayload: Prisma.SchemaDefinitionUpdateInput = {};

  if (data.name !== undefined) {
    updatePayload.name = data.name;
  }
  if (data.dataType !== undefined) {
    updatePayload.dataType = data.dataType;
  }
  if (data.tables !== undefined) {
    const validation = validateTableStructure(data.tables);
    if (!validation.isValid) {
      throw new Error(
        `Invalid table structure: ${validation.errors.join("; ")}`
      );
    }
    updatePayload.tables = formatTables(data.tables);
  }

  return prisma.schemaDefinition.update({
    where: { id },
    data: updatePayload,
  });
}

export async function deleteSchema(id: string): Promise<SchemaDefinition> {
  return prisma.schemaDefinition.delete({
    where: { id },
  });
}

// ============================================
// Versioning helpers
// ============================================

/**
 * Creates a new version of an existing schema by duplicating it with an
 * incremented `version` number.
 */
export async function createNewVersion(
  schemaId: string
): Promise<SchemaDefinition> {
  const existing = await prisma.schemaDefinition.findUnique({
    where: { id: schemaId },
  });

  if (!existing) {
    throw new Error(`SchemaDefinition with id "${schemaId}" not found`);
  }

  // Find the highest existing version for this workspace + name combo so
  // concurrent calls don't accidentally produce duplicate version numbers.
  const latest = await prisma.schemaDefinition.findFirst({
    where: { workspaceId: existing.workspaceId, name: existing.name },
    orderBy: { version: "desc" },
  });

  const nextVersion = (latest?.version ?? existing.version) + 1;

  return prisma.schemaDefinition.create({
    data: {
      workspaceId: existing.workspaceId,
      name: existing.name,
      dataType: existing.dataType,
      tables: existing.tables as Prisma.InputJsonValue,
      version: nextVersion,
    },
  });
}

/**
 * Lists all schema versions for a given workspace + schema name, ordered
 * newest first.
 */
export async function listVersions(
  workspaceId: string,
  name: string
): Promise<SchemaDefinition[]> {
  return prisma.schemaDefinition.findMany({
    where: { workspaceId, name },
    orderBy: { version: "desc" },
  });
}
