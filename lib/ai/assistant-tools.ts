import { tool, type InferUITools, type UIMessage } from "ai";
import { z } from "zod";
import { SUPPORTED_TYPES } from "@/lib/engine/tabular-engine";
import type {
  CardinalityConstraint,
  ColumnDefinition,
  ForeignKeyConstraint,
  TableStructure,
} from "@/types/database";

/**
 * Workspace assistant tools, shared by POST /api/chat (execution) and the
 * assistant drawer (typed tool parts). Pure module — safe on client and server.
 */

// ============================================
// Tool input — what Gemini fills in
// ============================================

const COLUMN_TYPES = SUPPORTED_TYPES as [string, ...string[]];

const referenceInput = z.object({
  table: z.string().describe("Parent table name"),
  column: z.string().describe("Parent table's primary key column"),
  cardinality: z
    .enum(["oneToOne", "oneToMany", "manyToMany"])
    .describe("Parent → child relationship; oneToMany for most links"),
  minRecords: z.number().int().min(0).describe("Min child rows per parent row"),
  maxRecords: z.number().int().min(1).describe("Max child rows per parent row"),
});

const columnInput = z.object({
  name: z.string().describe("snake_case column name"),
  type: z
    .enum(COLUMN_TYPES)
    .describe("Generator type. For a foreign key column, use the parent primary key's type."),
  primaryKey: z.boolean().describe("Exactly one column per table is the primary key"),
  unique: z.boolean(),
  nullRate: z
    .number()
    .min(0)
    .max(100)
    .describe("Percentage of NULL values (0 for required columns and keys)"),
  references: referenceInput
    .optional()
    .describe("Only on foreign key columns of RELATIONAL schemas"),
});

const schemaProposalInput = z.object({
  schemaName: z.string().describe("Short snake_case schema name, e.g. customer_orders"),
  dataType: z
    .enum(["TABULAR", "RELATIONAL"])
    .describe("TABULAR = exactly one table; RELATIONAL = several tables linked by foreign keys"),
  summary: z.string().describe("One sentence describing the schema"),
  tables: z.array(
    z.object({
      name: z.string().describe("snake_case table name"),
      columns: z.array(columnInput),
    })
  ),
});

type SchemaProposalInput = z.infer<typeof schemaProposalInput>;

// ============================================
// Normalized proposal — what the drawer applies
// ============================================

export interface ProposalColumn {
  name: string;
  type: string;
  primaryKey: boolean;
  unique: boolean;
  nullRate: number;
  references?: {
    table: string;
    column: string;
    cardinality: CardinalityConstraint["relationship"];
    minRecords: number;
    maxRecords: number;
  };
}

export interface SchemaProposal {
  schemaName: string;
  dataType: "TABULAR" | "RELATIONAL";
  summary: string;
  tables: { name: string; columns: ProposalColumn[] }[];
  /** Adjustments made so the proposal passes the designer's validation. */
  fixes: string[];
}

/** Same identifier rules as the Schema Designer's sanitizeColumnName. */
function sanitizeIdentifier(raw: string): string {
  return raw.trim().replace(/[^a-zA-Z0-9_]/g, "_").replace(/^[0-9]+/, "");
}

function uniqueName(base: string, taken: Set<string>): string {
  let name = base;
  for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${base}_${n}`;
  taken.add(name.toLowerCase());
  return name;
}

/**
 * Repairs a model-written schema so it always satisfies the designer's rules:
 * valid unique identifiers, exactly one PK per table, FKs that point at an
 * existing parent PK, and sane null rates / cardinality ranges.
 */
export function normalizeSchemaProposal(input: SchemaProposalInput): SchemaProposal {
  const fixes: string[] = [];
  const takenTables = new Set<string>();

  let tables = input.tables.map((table, t) => {
    const tableName = uniqueName(sanitizeIdentifier(table.name) || `table_${t + 1}`, takenTables);
    const takenColumns = new Set<string>();
    const columns: ProposalColumn[] = table.columns.map((col, c) => ({
      name: uniqueName(sanitizeIdentifier(col.name) || `column_${c + 1}`, takenColumns),
      type: (SUPPORTED_TYPES as string[]).includes(col.type) ? col.type : "Text",
      primaryKey: col.primaryKey,
      unique: col.unique,
      nullRate: Math.round(Math.min(100, Math.max(0, col.nullRate))),
      references: col.references ? { ...col.references } : undefined,
    }));

    // Exactly one primary key
    const pkIndexes = columns.flatMap((col, i) => (col.primaryKey ? [i] : []));
    if (pkIndexes.length === 0) {
      const idIndex = columns.findIndex((col) => col.name.toLowerCase() === "id");
      if (idIndex >= 0) {
        columns[idIndex].primaryKey = true;
      } else {
        const idName = uniqueName("id", takenColumns);
        columns.unshift({ name: idName, type: "UUID", primaryKey: true, unique: false, nullRate: 0 });
      }
      fixes.push(`${tableName}: added a primary key.`);
    } else if (pkIndexes.length > 1) {
      pkIndexes.slice(1).forEach((i) => (columns[i].primaryKey = false));
      fixes.push(`${tableName}: kept only the first primary key.`);
    }
    for (const col of columns) {
      if (col.primaryKey) col.nullRate = 0;
    }

    return { name: tableName, columns };
  });

  if (tables.length === 0) {
    tables = [{ name: "table_1", columns: [{ name: "id", type: "UUID", primaryKey: true, unique: false, nullRate: 0 }] }];
    fixes.push("The model returned no tables; started an empty one.");
  }

  const dataType: SchemaProposal["dataType"] =
    input.dataType === "RELATIONAL" || tables.length > 1 ? "RELATIONAL" : "TABULAR";

  if (dataType === "TABULAR") {
    for (const col of tables[0].columns) {
      if (col.references) {
        delete col.references;
        fixes.push(`${tables[0].name}.${col.name}: removed a foreign key (tabular schemas have one table).`);
      }
    }
  } else {
    // Resolve every FK to an existing parent's primary key
    for (const table of tables) {
      for (const col of table.columns) {
        const ref = col.references;
        if (!ref) continue;
        const label = `${table.name}.${col.name}`;
        const parent = tables.find(
          (t) => t.name.toLowerCase() === sanitizeIdentifier(ref.table).toLowerCase()
        );
        const parentPk = parent?.columns.find((c) => c.primaryKey);
        if (!parent || !parentPk || parent === table) {
          delete col.references;
          fixes.push(`${label}: dropped a reference to an unknown table "${ref.table}".`);
          continue;
        }
        if (col.primaryKey) {
          delete col.references;
          fixes.push(`${label}: a primary key cannot also be a foreign key.`);
          continue;
        }
        ref.table = parent.name;
        ref.column = parentPk.name;
        col.type = parentPk.type;
        col.unique = false;
        if (ref.cardinality === "oneToOne") {
          ref.minRecords = 1;
          ref.maxRecords = 1;
        } else {
          ref.maxRecords = Math.max(1, ref.maxRecords);
          ref.minRecords = Math.min(Math.max(0, ref.minRecords), ref.maxRecords);
        }
      }
    }
  }

  return {
    schemaName: sanitizeIdentifier(input.schemaName) || tables[0].name,
    dataType,
    summary: input.summary,
    tables: dataType === "TABULAR" ? tables.slice(0, 1) : tables,
    fixes,
  };
}

/** Converts a proposal into the TableStructure[] the Schema Designer loads. */
export function proposalToTableStructures(proposal: SchemaProposal): TableStructure[] {
  return proposal.tables.map((table) => {
    const nullRates: Record<string, number> = {};
    const foreignKeys: ForeignKeyConstraint[] = [];
    const cardinalities: Record<string, CardinalityConstraint> = {};

    const columns: ColumnDefinition[] = table.columns.map((col) => {
      if (col.nullRate > 0) nullRates[col.name] = col.nullRate;
      if (col.references) {
        foreignKeys.push({
          fromColumn: col.name,
          toTable: col.references.table,
          toColumn: col.references.column,
        });
        cardinalities[col.name] = {
          relationship: col.references.cardinality,
          targetTable: col.references.table,
          minRecords: col.references.minRecords,
          maxRecords: col.references.maxRecords,
        };
      }
      return {
        name: col.name,
        type: col.type,
        nullable: col.nullRate > 0,
        primaryKey: col.primaryKey || undefined,
        constraints: col.unique ? [{ type: "UNIQUE" }] : undefined,
      };
    });

    return {
      name: table.name,
      columns,
      ...(Object.keys(nullRates).length > 0 && { nullRates }),
      ...(foreignKeys.length > 0 && { foreignKeys, cardinalities }),
    };
  });
}

// ============================================
// Tool set + typed UI message
// ============================================

export const assistantTools = {
  proposeSchema: tool({
    description:
      "Propose a complete DataForge schema (tables and columns) for the user to apply in the Schema Designer. " +
      "Call it whenever the user asks to create, design, generate or change a schema. " +
      "When changing the current schema, send the FULL updated schema, not only the changes.",
    inputSchema: schemaProposalInput,
    execute: async (input) => normalizeSchemaProposal(input),
  }),
};

export type AssistantUIMessage = UIMessage<never, never, InferUITools<typeof assistantTools>>;

/** Extra request body the drawer sends with every chat request. */
export interface AssistantRequestContext {
  /** The schema currently open in the Schema Designer, if any. */
  schema: { name: string; dataType: string; tables: TableStructure[] } | null;
}
