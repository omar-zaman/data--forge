# Implementation Plan: Workspace Navigation & Tabular Schema Designer UI

## Overview

This plan builds the workspace navigation and tabular schema designer on top of the existing DataForge API layer. Tasks are ordered so each step is independently runnable: Shadcn primitives first, then the workspace page shell, then the designer component in three passes (state + UI → load → save), then input sanitization and validation, and finally the dashboard update.

No API routes, Prisma schema, or auth configuration are modified.

---

## Tasks

- [x] 1. Install Shadcn UI primitives
  - Run `npx shadcn@latest add tabs card input select slider switch skeleton sonner` in the project root.
  - Verify that `components/ui/` now contains `tabs.tsx`, `card.tsx`, `input.tsx`, `select.tsx`, `slider.tsx`, `switch.tsx`, `skeleton.tsx`, and `sonner.tsx` (or equivalent generated files).
  - Add `<Toaster />` from `"sonner"` into `app/layout.tsx` so toasts are globally available.
  - _Requirements: 1.1, 1.2, 1.3_

- [x] 2. Create workspace detail page with tabs and skeleton loading
  - [x] 2.1 Create `app/(protected)/workspace/[id]/page.tsx`
    - Async server component; await `params` to extract `id`.
    - Fetch `GET /api/workspaces/${id}` using `fetch` with forwarded cookies (`headers()` from `next/headers`).
    - Call `notFound()` on 404 or 403 responses.
    - Render workspace name, optional description, and a back link to `/dashboard`.
    - Render Shadcn `<Tabs defaultValue="tabular">` with three `<TabsTrigger>` entries: **Tabular**, **Relational**, **Documents**.
    - Tabular `<TabsContent>`: wrap a `<SchemaDesigner workspaceId={id} />` placeholder in a `<Suspense fallback={<SchemaDesignerSkeleton />}>`.
    - Relational and Documents `<TabsContent>`: render a Shadcn `<Card>` with "Coming Soon" text.
    - Inline `SchemaDesignerSkeleton`: three `<Skeleton>` rows approximating the designer layout (name input + three column rows).
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9_

- [x] 3. Build SchemaDesigner component — state management and column row UI
  - [x] 3.1 Create `components/modules/schema/schema-designer.tsx`
    - Add `"use client"` directive.
    - Define `UIDataType` union type and `ColumnRow` interface as specified in the design document.
    - Define `sanitizeColumnName(raw: string): string` — replaces non-`[a-zA-Z0-9_]` chars with `_`, strips leading digits.
    - Define `columnRowsToTableStructure(name: string, rows: ColumnRow[]): TableStructure` — maps `ColumnRow[]` to a single `TableStructure` using `ColumnDefinition`, `ColumnConstraint` from `@/types/database`.
    - Define `colDefToColumnRow(col: ColumnDefinition, nullRates: Record<string, number>): ColumnRow` for loading existing schemas.
    - Initialize state: `schemaName`, `columns`, `existingSchemaId`, `isLoading`, `isSaving`, `loadError`.
    - _Requirements: 5.1, 7.1, 7.2, 7.3, 8.2_

  - [x] 3.2 Implement column row UI
    - Render a schema name `<Input>` at the top of the component.
    - Render each `ColumnRow` in `columns` as a row containing: name `<Input>` (with `sanitizeColumnName` on `onChange`), type `<Select>` (UIDataType options), null rate `<Slider min={0} max={100}>` with numeric label, `isUnique` `<Switch>`, `isPrimaryKey` `<Switch>` (toggles off others), Up/Down arrow `<Button>` controls, and a trash-icon Delete `<Button>`.
    - Render an "Add Column" `<Button>` that appends a default `ColumnRow` (name `""`, type `"Name"`, nullRate `0`, isUnique `false`, isPrimaryKey `false`, id `crypto.randomUUID()`).
    - Render empty state when `columns.length === 0`: card with text "No columns yet — add your first column" and an "Add Column" button.
    - Implement Up/Down swap handlers and delete handler.
    - Implement single-PK enforcement: when `isPrimaryKey` is toggled true on column N, set `isPrimaryKey: false` on all other columns.
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8_

- [x] 4. Implement load-existing-schema logic
  - [x] 4.1 Add `useEffect` fetch in `SchemaDesigner`
    - On mount, fetch `GET /api/schemas?workspaceId=${workspaceId}`.
    - Set `isLoading = true` before fetch; set `isLoading = false` in the finally block.
    - On success with non-empty array: extract `result[0]`; parse `tables` field (cast from JSON); call `colDefToColumnRow` for each column of `tables[0]`; set `schemaName`, `columns`, and `existingSchemaId`.
    - On success with empty array: leave `columns` as `[]` (empty state is shown automatically).
    - On error: call `setLoadError(message)`.
    - Render a loading spinner / skeleton while `isLoading` is true.
    - Render an error banner with a "Retry" button when `loadError` is non-null.
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_

- [ ] 5. Implement save schema logic (POST / PATCH with mapping)
  - [ ] 5.1 Add `handleSave` async function to `SchemaDesigner`
    - Run client-side validation: schema name non-empty; `columns.length > 0`; exactly one column with `isPrimaryKey: true`; all `column.name` non-empty. On failure, call `toast.error(message)` from sonner and return early.
    - Build `TableStructure` via `columnRowsToTableStructure(schemaName, columns)`.
    - Check `JSON.stringify([table]).length > 512_000`; if so call `toast.warning("Schema payload exceeds 500 KB limit")` and return early.
    - Set `isSaving = true` before fetch; set `isSaving = false` in the finally block; disable "Save Schema" button while `isSaving`.
    - If `existingSchemaId === null`: `fetch("/api/schemas", { method: "POST", body: JSON.stringify({ workspaceId, name: schemaName, dataType: "TABULAR", tables: [table] }) })`.
    - If `existingSchemaId !== null`: `fetch(\`/api/schemas/${existingSchemaId}\`, { method: "PATCH", body: JSON.stringify({ name: schemaName, tables: [table] }) })`.
    - On 2xx: `toast.success("Schema saved successfully.")`. If POST, update `existingSchemaId` from the response body.
    - On non-2xx or network error: parse error message from response JSON and call `toast.error(message)`.
    - Render the "Save Schema" `<Button>` that calls `handleSave` on click.
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9, 6.10, 8.1_

- [ ] 6. Implement column name sanitization and client-side validation
  - Ensure `sanitizeColumnName` is applied on every `onChange` of the column name `<Input>` (already wired in task 3.2; this task verifies correctness and edge cases).
  - Verify sanitization handles: spaces → `_`, special characters → `_`, leading digits stripped, empty string preserved as-is (validation catches this on save).
  - Verify all validation error messages match the error handling table in the design document.
  - No new files; changes are within `components/modules/schema/schema-designer.tsx`.
  - _Requirements: 5.3, 6.2, 6.3, 7.3, 8.2_

- [ ] 7. Modify dashboard to show live workspace list with links
  - [ ] 7.1 Update `app/(protected)/dashboard/page.tsx`
    - Add a server-side `fetch("/api/workspaces", { headers: { Cookie: ... } })` call (forwarded cookies via `next/headers`).
    - Extract `data: Workspace[]` from `PaginatedResponse<Workspace>`.
    - Replace the static "Workspaces" `<div>` section with a mapped list of workspace cards, each containing: workspace name (`font-semibold`), description (two-line clamp via `line-clamp-2`), formatted `createdAt` date, and an "Open Workspace →" `<Link href={"/workspace/" + workspace.id}>`.
    - Render empty state when `data.length === 0`: "You don't have any workspaces yet."
    - Wrap the fetch in a try/catch; render a fallback message on error without crashing.
    - Keep existing stats section, header row, and API reference panel.
    - Import `Workspace` type from `@/types/database`.
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

- [ ] 8. Final checkpoint — TypeScript and build verification
  - Run `npx tsc --noEmit` and resolve any type errors.
  - Run `npm run lint` and resolve any lint errors.
  - Ensure all new files use strict types, no `any`, and all imports resolve correctly.
  - _Requirements: 7.3, 7.4_

---

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP. No tasks in this plan are marked optional because tests are out of scope per the feature brief.
- Each task references specific requirements from `requirements.md` for traceability.
- The Shadcn CLI (`npx shadcn@latest add ...`) must be run manually in a terminal since it is an interactive long-running command; it is not executed by the coding agent.
- After task 1, verify the `app/layout.tsx` `<Toaster />` registration before proceeding to tasks that use toasts (tasks 5 and 6).
- The `fetch` calls in server components use `headers()` from `next/headers` to forward the session cookie. The client component (`SchemaDesigner`) uses bare `fetch` — same-origin cookies are sent automatically by the browser.
- `colDefToColumnRow` uses `crypto.randomUUID()` which is available in the browser and in Node.js 19+. For SSR hydration safety, UUIDs should only be generated client-side (component is already `"use client"`).

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1"] },
    { "id": 1, "tasks": ["2.1", "3.1"] },
    { "id": 2, "tasks": ["3.2", "4.1"] },
    { "id": 3, "tasks": ["5.1"] },
    { "id": 4, "tasks": ["6", "7.1"] },
    { "id": 5, "tasks": ["8"] }
  ]
}
```
