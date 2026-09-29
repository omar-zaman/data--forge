# Requirements Document

## Introduction

This feature adds a navigable Workspace detail page and a Tabular Schema Designer UI to the DataForge application. Users can open any of their workspaces from the dashboard, land on a tabbed workspace view, and interactively define a tabular schema (columns, types, null rates, uniqueness, and primary keys) that is persisted via the existing REST API. The dashboard is updated to display a live list of workspace cards with direct navigation links.

This is Phase 2.1 of the DataForge v0.3.0 roadmap. No Prisma schema, API route logic, NextAuth configuration, or middleware is modified.

---

## Glossary

- **Workspace**: A named container (MongoDB document) owned by a user, grouping schema definitions and generation jobs.
- **SchemaDefinition**: A versioned schema record stored in MongoDB via Prisma, containing a `tables` JSON field of `TableStructure[]`.
- **TableStructure**: The DB-level representation of one table: `{ name, columns, nullRates, foreignKeys, cardinalities }`.
- **ColumnDefinition**: A single column within a `TableStructure`: `{ name, type, nullable?, primaryKey?, defaultValue?, constraints? }`.
- **ColumnRow**: A UI-only state type extending `ColumnDefinition` with a stable React key (`id: string`), a `nullRate: number`, and `isUnique: boolean`.
- **SchemaDesigner**: The `"use client"` React component at `components/modules/schema/schema-designer.tsx` that manages column state and submits to the API.
- **DataType**: Prisma enum — `TABULAR | RELATIONAL | DOCUMENT`.
- **UIDataType**: The set of human-readable column type labels shown in the Select control: `Name | Email | Phone | Number | Date | Boolean | Custom Regex`.
- **Shadcn UI**: The component library configured in `components.json`; primitives are installed via the `shadcn` CLI.
- **Sonner**: The toast notification library bundled with Shadcn UI.
- **PaginatedResponse**: The shape returned by `GET /api/workspaces`: `{ data: Workspace[], pagination: { page, limit, total, totalPages } }`.

---

## Requirements

### Requirement 1: Shadcn UI Primitive Installation

**User Story:** As a developer, I want the required Shadcn UI primitives installed, so that UI components can be assembled from a consistent, accessible component library.

#### Acceptance Criteria

1. THE Developer SHALL install the following Shadcn primitives into `components/ui/` using the `shadcn` CLI: `tabs`, `card`, `input`, `select`, `slider`, `switch`, `skeleton`, `sonner`.
2. WHEN the primitives are installed, THE Project SHALL compile without TypeScript errors.
3. THE Sonner `<Toaster />` component SHALL be registered in `app/layout.tsx` so that toast notifications are globally available.

---

### Requirement 2: Dashboard — Live Workspace List

**User Story:** As a user, I want to see all my workspaces listed on the dashboard, so that I can navigate directly into any workspace without knowing its ID.

#### Acceptance Criteria

1. THE Dashboard Page SHALL fetch the authenticated user's workspaces server-side via `GET /api/workspaces` and render the result.
2. WHEN the user has one or more workspaces, THE Dashboard Page SHALL display each workspace as a card showing: workspace name, description (truncated to two lines), and formatted creation date.
3. WHEN the user has no workspaces, THE Dashboard Page SHALL display an empty-state message: "You don't have any workspaces yet."
4. WHEN a workspace card is rendered, THE Dashboard Page SHALL include an "Open Workspace →" link that navigates to `/workspace/[id]` for that workspace.
5. THE Dashboard Page SHALL preserve the existing stats section, header row, and API reference panel without modification.
6. IF the workspace fetch fails, THEN THE Dashboard Page SHALL display a fallback message without crashing the page.

---

### Requirement 3: Workspace Detail Page

**User Story:** As a user, I want a dedicated workspace page with tabbed navigation, so that I can manage schemas and future features within a workspace context.

#### Acceptance Criteria

1. THE Workspace Page SHALL be a Next.js server component located at `app/(protected)/workspace/[id]/page.tsx`.
2. WHEN a valid workspace ID is provided and the workspace belongs to the authenticated user, THE Workspace Page SHALL display the workspace name and description.
3. THE Workspace Page SHALL render three tabs using Shadcn Tabs: **Tabular**, **Relational**, and **Documents**.
4. WHEN the **Tabular** tab is active, THE Workspace Page SHALL render the `SchemaDesigner` component for the workspace.
5. WHEN the **Relational** or **Documents** tab is active, THE Workspace Page SHALL display a "Coming Soon" placeholder message.
6. WHILE workspace data is loading, THE Workspace Page SHALL display Shadcn Skeleton loaders via a React Suspense boundary.
7. IF the workspace ID does not correspond to an existing workspace, THEN THE Workspace Page SHALL call Next.js `notFound()`.
8. IF the authenticated user does not own the fetched workspace, THEN THE Workspace Page SHALL call Next.js `notFound()`.
9. THE Workspace Page SHALL include a back-navigation link to `/dashboard`.

---

### Requirement 4: Schema Designer — Initial Load

**User Story:** As a user, I want the schema designer to pre-populate with my existing schema when I open a workspace, so that I can continue editing where I left off.

#### Acceptance Criteria

1. WHEN the SchemaDesigner mounts, THE SchemaDesigner SHALL fetch schemas for the workspace via `GET /api/schemas?workspaceId={id}`.
2. WHEN the fetch returns one or more schemas, THE SchemaDesigner SHALL load the first schema (sorted by name ascending then version descending, matching the service's default order) into local state.
3. WHEN loading an existing schema, THE SchemaDesigner SHALL populate the schema name input and reconstruct the `ColumnRow[]` array from the schema's `tables[0].columns` and `tables[0].nullRates`.
4. WHILE the initial fetch is in progress, THE SchemaDesigner SHALL display a loading indicator.
5. WHEN the fetch returns an empty array (no existing schema), THE SchemaDesigner SHALL display the empty-state: "No columns yet — add your first column."
6. IF the fetch fails, THEN THE SchemaDesigner SHALL display an error message and allow the user to retry.

---

### Requirement 5: Schema Designer — Column Management

**User Story:** As a user, I want to add, configure, reorder, and remove columns in the schema designer, so that I can precisely define my tabular schema structure.

#### Acceptance Criteria

1. WHEN the user clicks "Add Column", THE SchemaDesigner SHALL append a new `ColumnRow` with default values: empty name, type `Name`, null rate 0, `isUnique: false`, `primaryKey: false`.
2. THE SchemaDesigner SHALL render each `ColumnRow` with the following controls:
   - a. A text input for the field name.
   - b. A Select control for the data type with options: `Name`, `Email`, `Phone`, `Number`, `Date`, `Boolean`, `Custom Regex`.
   - c. A Slider (0–100) for the null rate percentage.
   - d. A Switch for `isUnique`.
   - e. A Switch for `isPrimaryKey`.
   - f. A delete button with a trash icon.
3. WHEN the user types in the field name input, THE SchemaDesigner SHALL sanitize the value, retaining only characters matching `/^[a-zA-Z_][a-zA-Z0-9_]*$/` rules (strip leading digits, replace spaces and invalid characters with underscores).
4. WHEN the user toggles `isPrimaryKey` to true on a column, THE SchemaDesigner SHALL set `isPrimaryKey: false` on all other columns (only one PK at a time).
5. THE SchemaDesigner SHALL render Up and Down arrow buttons on each column row for reordering.
6. WHEN the user clicks the Up button on a column that is not the first column, THE SchemaDesigner SHALL swap that column with the one above it.
7. WHEN the user clicks the Down button on a column that is not the last column, THE SchemaDesigner SHALL swap that column with the one below it.
8. WHEN the user clicks the delete button on a column row, THE SchemaDesigner SHALL remove that column from state.

---

### Requirement 6: Schema Designer — Save Schema

**User Story:** As a user, I want to save my schema definition, so that it is persisted to the database and available for data generation.

#### Acceptance Criteria

1. THE SchemaDesigner SHALL display a "Save Schema" button.
2. WHEN the user clicks "Save Schema", THE SchemaDesigner SHALL perform client-side validation before submitting:
   - a. Schema name must be non-empty.
   - b. At least one column must exist.
   - c. Exactly one column must have `isPrimaryKey: true`.
   - d. All column names must be non-empty after sanitization.
3. IF client-side validation fails, THEN THE SchemaDesigner SHALL display a Sonner toast with the specific validation error message and SHALL NOT submit the request.
4. WHEN building the API payload, THE SchemaDesigner SHALL map `ColumnRow[]` to a single `TableStructure` as follows:
   - a. `table.name` = the schema name input value.
   - b. `table.columns` = an array of `ColumnDefinition` objects, where `type` is the string value of `UIDataType`, `primaryKey` is set for the PK column, `nullable` is `true` when `nullRate > 0` and `false` when `nullRate === 0`, and `constraints` includes `{ type: "UNIQUE" }` when `isUnique` is `true`.
   - c. `table.nullRates` = a `Record<string, number>` mapping each column name to its null rate value.
5. WHEN no existing schema was loaded on mount, THE SchemaDesigner SHALL submit a `POST` request to `/api/schemas` with body `{ workspaceId, name, dataType: "TABULAR", tables: [mappedTable] }`.
6. WHEN an existing schema was loaded on mount, THE SchemaDesigner SHALL submit a `PATCH` request to `/api/schemas/[existingSchemaId]` with body `{ name, tables: [mappedTable] }`.
7. WHEN `JSON.stringify(tables).length` exceeds 512,000 bytes (500 KB), THE SchemaDesigner SHALL display a Sonner warning toast and SHALL NOT submit the request.
8. WHILE the save request is in-flight, THE SchemaDesigner SHALL disable the "Save Schema" button to prevent duplicate submissions.
9. WHEN the save succeeds, THE SchemaDesigner SHALL display a Sonner success toast: "Schema saved successfully."
10. IF the save request fails (network error or non-2xx response), THEN THE SchemaDesigner SHALL display a Sonner error toast containing the error message returned by the API.

---

### Requirement 7: TypeScript Correctness

**User Story:** As a developer, I want all new code to be strictly typed, so that the codebase remains maintainable and type-safe.

#### Acceptance Criteria

1. THE SchemaDesigner SHALL define and use a `ColumnRow` interface: `{ id: string; name: string; type: UIDataType; nullRate: number; isUnique: boolean; isPrimaryKey: boolean }`.
2. THE SchemaDesigner SHALL import and use `TableStructure`, `ColumnDefinition`, and `ColumnConstraint` from `@/types/database` for the API payload construction.
3. THE Project SHALL contain no `any` type annotations in any file created or modified by this feature.
4. THE Project SHALL pass `tsc --noEmit` without errors after all changes are applied.

---

### Requirement 8: Security and Input Handling

**User Story:** As a developer, I want all user input sanitized and API calls authenticated, so that the application remains secure.

#### Acceptance Criteria

1. THE SchemaDesigner SHALL use `fetch` for API calls; same-origin cookies ensure the session token is sent automatically without manual header injection.
2. WHEN a column name input value is committed, THE SchemaDesigner SHALL strip any leading numeric characters and replace all characters not matching `[a-zA-Z0-9_]` with underscores.
3. THE Workspace Page SHALL rely on the existing protected layout at `app/(protected)/layout.tsx` and the existing `middleware.ts` for route-level authentication enforcement; no new auth logic is required.
