# Design Document: Workspace Navigation & Tabular Schema Designer UI

## Overview

This document describes the architecture and implementation design for Phase 2.1 of DataForge — the Workspace detail page and the Tabular Schema Designer UI. The feature adds three new files to the project (`app/(protected)/workspace/[id]/page.tsx`, `components/modules/schema/schema-designer.tsx`) and modifies one existing page (`app/(protected)/dashboard/page.tsx`). It also installs eight Shadcn UI primitives.

No API routes, Prisma schema, auth configuration, or service layer code is modified.

---

## Architecture

### Component Tree

```
app/(protected)/layout.tsx            (existing — auth guard)
└── app/(protected)/workspace/[id]/page.tsx   (NEW — server component)
    ├── <WorkspaceHeader />            (inline — workspace name + back link)
    ├── <Tabs> (Shadcn)
    │   ├── TabsTrigger: Tabular
    │   ├── TabsTrigger: Relational
    │   ├── TabsTrigger: Documents
    │   └── TabsContent: Tabular
    │       └── <Suspense fallback={<SchemaDesignerSkeleton />}>
    │           └── <SchemaDesigner workspaceId={id} />   (NEW — client component)
    │       TabsContent: Relational / Documents
    │           └── "Coming Soon" placeholder
    └── (notFound() called for missing/unauthorized workspace)

app/(protected)/dashboard/page.tsx    (MODIFIED — server component)
├── (existing) stats cards
├── (existing) header row
├── WorkspaceList (inline)
│   └── WorkspaceCard[] (inline)
└── (existing) API reference panel
```

### File Responsibilities

| File | Role | Render Mode |
|------|------|-------------|
| `app/(protected)/workspace/[id]/page.tsx` | Fetch workspace, own page layout, tab shell | Server Component |
| `components/modules/schema/schema-designer.tsx` | Column state, API load/save, form UI | Client Component (`"use client"`) |
| `app/(protected)/dashboard/page.tsx` | Fetch workspaces list, workspace cards | Server Component (modified) |
| `app/layout.tsx` | Register `<Toaster />` globally | Server Component (modified) |

---

## Data Flow

### Dashboard — Workspace List Load

```
DashboardPage (server)
  │
  ├─ fetch("/api/workspaces")        ← GET, server-side, same process
  │    returns PaginatedResponse<Workspace>
  │
  └─ renders WorkspaceCard[] from response.data
        or empty-state when response.data.length === 0
```

The fetch is performed directly via `fetch()` in the server component. Cookies are forwarded by passing the `Cookie` header from `headers()` (Next.js server-side fetch credential forwarding pattern).

### Workspace Page Load

```
WorkspacePage (server, receives { params: { id } })
  │
  ├─ fetch(`/api/workspaces/${id}`)   ← GET, verifies ownership server-side
  │    → 404 / 403 → call notFound()
  │    → 200 → workspace object
  │
  └─ renders <Tabs> with <SchemaDesigner workspaceId={id} /> inside Suspense
```

### Schema Designer — Load Existing Schema

```
SchemaDesigner (client, mounts with workspaceId prop)
  │
  ├─ useEffect on mount:
  │    fetch(`/api/schemas?workspaceId=${workspaceId}`)
  │    → SchemaDefinition[]  (sorted by name asc, version desc)
  │
  ├─ If result.length > 0:
  │    existingSchema = result[0]
  │    parseTables from existingSchema.tables → TableStructure[]
  │    tableRow = tables[0]   (single table for TABULAR)
  │    setSchemaName(existingSchema.name)
  │    setColumns(tableRow.columns.map(colDefToColumnRow(tableRow.nullRates)))
  │    setExistingSchemaId(existingSchema.id)
  │
  └─ If result.length === 0:
       render empty state
```

#### `colDefToColumnRow` helper (pure function, defined in component file)

```typescript
function colDefToColumnRow(
  col: ColumnDefinition,
  nullRates: Record<string, number>
): ColumnRow {
  return {
    id: crypto.randomUUID(),
    name: col.name,
    type: stringToUIDataType(col.type),   // maps stored string → UIDataType
    nullRate: nullRates[col.name] ?? 0,
    isUnique: col.constraints?.some(c => c.type === "UNIQUE") ?? false,
    isPrimaryKey: col.primaryKey ?? false,
  };
}
```

### Schema Designer — Save Schema

```
User clicks "Save Schema"
  │
  ├─ Client-side validation (see Requirement 6.2)
  │    → failure: toast error, abort
  │
  ├─ Build payload: columnRowsToTableStructure(schemaName, columns)
  │
  ├─ Payload size guard: JSON.stringify(tables).length > 512_000
  │    → warning toast, abort
  │
  ├─ If existingSchemaId === null:
  │    fetch("/api/schemas", { method: "POST", body: { workspaceId, name, dataType: "TABULAR", tables } })
  │
  └─ If existingSchemaId !== null:
       fetch(`/api/schemas/${existingSchemaId}`, { method: "PATCH", body: { name, tables } })
  │
  ├─ On success (2xx): toast "Schema saved successfully."
  └─ On error: toast with API error message or generic fallback
```

---

## State Shape

### `ColumnRow` Interface

The UI-level column state type lives in `components/modules/schema/schema-designer.tsx`. It is separate from the DB-level `ColumnDefinition` to carry React-specific fields (`id`) and UI-specific fields (`nullRate`, `isUnique`, `isPrimaryKey`).

```typescript
// UIDataType — human-readable column type shown in the Select control
type UIDataType =
  | "Name"
  | "Email"
  | "Phone"
  | "Number"
  | "Date"
  | "Boolean"
  | "Custom Regex";

// ColumnRow — UI-only state; NOT persisted directly
interface ColumnRow {
  id: string;           // crypto.randomUUID() — stable React key, never sent to API
  name: string;         // sanitized column name
  type: UIDataType;     // maps to ColumnDefinition.type string on save
  nullRate: number;     // 0–100 slider value; becomes nullRates[col.name] and col.nullable
  isUnique: boolean;    // true → add { type: "UNIQUE" } to col.constraints
  isPrimaryKey: boolean; // true → col.primaryKey = true (only one allowed at a time)
}
```

### `SchemaDesigner` Component State

```typescript
const [schemaName, setSchemaName] = useState<string>("");
const [columns, setColumns] = useState<ColumnRow[]>([]);
const [existingSchemaId, setExistingSchemaId] = useState<string | null>(null);
const [isLoading, setIsLoading] = useState<boolean>(true);
const [isSaving, setIsSaving] = useState<boolean>(false);
const [loadError, setLoadError] = useState<string | null>(null);
```

---

## API Mapping

### `ColumnRow[]` → `TableStructure` Mapping

The `columnRowsToTableStructure` pure function (defined in the component file) performs the full translation:

```typescript
import type { TableStructure, ColumnDefinition, ColumnConstraint } from "@/types/database";

function columnRowsToTableStructure(
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
      type: row.type,                      // UIDataType string stored as-is
      nullable: row.nullRate > 0,
      primaryKey: row.isPrimaryKey || undefined,
      constraints: constraints.length > 0 ? constraints : undefined,
    };
  });

  const nullRates: Record<string, number> = {};
  for (const row of rows) {
    if (row.nullRate > 0) {
      nullRates[row.name] = row.nullRate;
    }
  }

  return {
    name,
    columns,
    nullRates: Object.keys(nullRates).length > 0 ? nullRates : undefined,
  };
}
```

### API Payload Shapes

**POST `/api/schemas`** (new schema):
```json
{
  "workspaceId": "<string>",
  "name": "<schemaName>",
  "dataType": "TABULAR",
  "tables": [ /* TableStructure */ ]
}
```

**PATCH `/api/schemas/[id]`** (update existing):
```json
{
  "name": "<schemaName>",
  "tables": [ /* TableStructure */ ]
}
```

Both endpoints are already implemented and validate `tables` via `validateTableStructure` (name required, ≥1 column, exactly 1 PK, FK refs must exist).

---

## Column Name Sanitization

The `sanitizeColumnName` pure function is applied on every `onChange` of the name input:

```typescript
function sanitizeColumnName(raw: string): string {
  // Replace any character that is not alphanumeric or underscore with "_"
  const replaced = raw.replace(/[^a-zA-Z0-9_]/g, "_");
  // Strip leading digits (identifiers cannot start with a number)
  return replaced.replace(/^[0-9]+/, "");
}
```

The result is stored directly into `ColumnRow.name`. Empty string is a valid intermediate state during typing; validation on save catches empty names.

---

## Components and Interfaces

### `app/(protected)/workspace/[id]/page.tsx`

```
Props: none (receives route params via Next.js page convention)
Async params: { id: string }

Responsibilities:
  1. Await params, extract id
  2. Call fetch(`/api/workspaces/${id}`) with forwarded cookies
  3. If response.status === 404 or 403 → notFound()
  4. Render page layout: back link, workspace name/description, Tabs
  5. Tabs: Tabular → <Suspense><SchemaDesigner workspaceId={id} /></Suspense>
            Relational / Documents → "Coming Soon" cards
```

### `components/modules/schema/schema-designer.tsx`

```
Props: { workspaceId: string }

Responsibilities:
  1. Fetch schemas on mount (useEffect)
  2. Manage ColumnRow[] state
  3. Render column rows with all per-row controls
  4. Handle add / delete / reorder column actions
  5. Sanitize column names on input change
  6. Enforce single-PK invariant on isPrimaryKey toggle
  7. Run client-side validation before save
  8. Map state → TableStructure and POST or PATCH
  9. Show loading / error / empty states
  10. Display Sonner toasts for save results
```

### Modified: `app/(protected)/dashboard/page.tsx`

```
Changes:
  - Add server-side fetch of GET /api/workspaces
  - Replace static Workspaces card with dynamic WorkspaceCard list
  - Render empty state when no workspaces
  - Keep all other sections unchanged
```

### Modified: `app/layout.tsx`

```
Changes:
  - Import and render <Toaster /> from "sonner" (Shadcn)
  - Place outside the main content, typically at end of <body>
```

---

## Data Models

### DB Types Used (from `types/database.ts`)

```typescript
// Already defined — used as-is for API payload construction
TableStructure {
  name: string;
  columns: ColumnDefinition[];
  nullRates?: Record<string, number>;
  foreignKeys?: ForeignKeyConstraint[];
  cardinalities?: Record<string, CardinalityConstraint>;
}

ColumnDefinition {
  name: string;
  type: string;
  nullable?: boolean;
  primaryKey?: boolean;
  defaultValue?: unknown;
  constraints?: ColumnConstraint[];
}

ColumnConstraint {
  type: "UNIQUE" | "CHECK" | "DEFAULT" | "NOT_NULL";
  value?: unknown;
}
```

### API Response Types

```typescript
// GET /api/workspaces
PaginatedResponse<Workspace> = {
  data: Workspace[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

// GET /api/schemas?workspaceId=
SchemaDefinition[]   // sorted by name asc, version desc

// GET /api/workspaces/[id]
WorkspaceWithRelations   // includes schemaDefinitions and generationJobs
```

---

## Error Handling

| Scenario | Handling |
|----------|----------|
| `GET /api/workspaces/[id]` returns 404 or 403 on workspace page | `notFound()` — renders Next.js 404 page |
| `GET /api/workspaces` fails on dashboard | Render fallback message; do not crash page |
| `GET /api/schemas` fails in SchemaDesigner on mount | `setLoadError(message)` — renders error banner with Retry button |
| Client validation fails on save | Sonner error toast; do not submit |
| Payload size exceeds 500 KB | Sonner warning toast; do not submit |
| `POST` or `PATCH` returns non-2xx | Sonner error toast with API error message |
| Network error on save | Sonner error toast with generic fallback message |
| Empty schema name on save | Sonner error toast: "Schema name is required" |
| No columns on save | Sonner error toast: "Add at least one column before saving" |
| No PK column on save | Sonner error toast: "Exactly one column must be set as Primary Key" |
| Empty column name on save | Sonner error toast: "All column names must be non-empty" |

---

## Testing Strategy

This feature is a UI-heavy CRUD feature:
- The workspace page and dashboard are server components performing straightforward data fetching and rendering.
- The SchemaDesigner is a client component managing local state and issuing fetch calls to existing, already-tested API routes.
- The only standalone logic (`sanitizeColumnName`, `columnRowsToTableStructure`, `colDefToColumnRow`) consists of pure functions, but their input spaces are small and fully described by a handful of concrete examples.

**PBT assessment**: Property-based testing is not appropriate here. There are no universal properties across a large or unbounded input space that 100+ randomized iterations would explore meaningfully beyond what targeted example-based unit tests cover. The column sanitization rules are fully enumerable; the mapping logic is a deterministic structural transformation with no algorithmic complexity.

Testing strategy:
- **Manual / exploratory testing**: Load workspace page, designer, save flow end-to-end.
- **Example-based unit tests** (optional, not in scope for this phase): `sanitizeColumnName` edge cases, `columnRowsToTableStructure` mapping for PK/nullable/unique permutations.
- **TypeScript compilation** (`tsc --noEmit`) as the primary automated correctness check for the mapping and state types.
