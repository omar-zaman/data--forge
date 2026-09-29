# DataForge - Project Status

**Last Updated**: September 2026  
**Version**: 0.3.1  
**Status**: Phase 2.1 — Workspace Schema Designer (Task 1 Complete)

---

## 🎯 Project Overview

**DataForge** is a full-stack Synthetic Data & Document Platform that generates realistic data from user-defined schemas and visual templates, supporting tabular, relational, and document data types.

### Tech Stack

- **Framework**: Next.js 16.3.7 (App Router), React 19, TypeScript 5
- **Styling**: Tailwind CSS v4, Shadcn UI (components.json configured)
- **Database**: MongoDB + Prisma ORM v5.22
- **Auth**: NextAuth.js v5 (`next-auth@5.0.0-beta.32`) with Prisma adapter
- **Icons**: Lucide React
- **Utilities**: clsx, tailwind-merge, bcryptjs

---

## ✅ Completed Phases

### Phase 1.1: Foundation Setup ✅
- Next.js with App Router, TypeScript, Tailwind CSS v4, Shadcn UI
- Utility functions (`lib/utils.ts`), landing page, dark mode support

### Phase 1.2: Database Architecture ✅
- Prisma + MongoDB configured with singleton client (`lib/db/prisma.ts`)
- Type-safe database types (`types/database.ts`), query helpers (`lib/db/queries.ts`), seed script

### Phase 1.3: Authentication ✅
- NextAuth.js v5 with Prisma adapter (`auth.ts`, `auth.config.ts`)
- Email/password credentials + OAuth (Google, GitHub) with `allowDangerousEmailAccountLinking`
- JWT session strategy; session enriched with `id`, `role`, `email`, `name`, `image`
- Protected routes via `middleware.ts`; redirects unauthenticated users to `/login?callbackUrl=...`
- `getCurrentUser` helper (`lib/auth/session.ts`), `signInUser`/`signOutUser` server actions (`lib/auth/actions.ts`)

### Phase 1.4: MongoDB Schema Transition ✅

**Objective**: Transition DataForge to the HackDataV2 Synthetic Data & Document Platform schema.

#### Schema Changes
| Old Model | New Model | Notes |
|-----------|-----------|-------|
| `Project` | `Workspace` | Renamed, same fields |
| `Schema` | `SchemaDefinition` | Enhanced with DataType, tables JSON, versioning |
| `Template` | `VisualTemplate` | Redesigned for document layout |
| `GenerationJob` | `GenerationJob` | Updated: progress, seed, locale, healthCheckPassed, validationErrors |
| `ValidationResult` | `ValidationResult` | Updated: errors as JSON array |
| `Dataset` | *(removed)* | Deprecated |
| `AIConversation` | *(removed)* | Deprecated |
| `ExportLog` | *(removed)* | Deprecated |

#### Enums (Current)
- `UserRole`: USER, ADMIN, DEVELOPER
- `JobStatus`: QUEUED, PROCESSING, VALIDATING, COMPLETED, FAILED
- `DataType`: TABULAR, RELATIONAL, DOCUMENT
- `ExportFormat`: CSV, JSON, SQL, PDF, ZIP

#### Completed Tasks

**Schema & Types**
- ✅ 1.1 — Enums updated (JobStatus, DataType, ExportFormat)
- ✅ 1.2 — Project → Workspace rename
- ✅ 1.3 — SchemaDefinition model created
- ✅ 1.4 — GenerationJob model updated (11 new/updated fields)
- ✅ 1.5 — VisualTemplate model created
- ✅ 1.6 — ValidationResult model updated
- ✅ 1.7 — Deprecated models removed
- ✅ 1.8 — Prisma client generated, schema validated
- ✅ 1.9 — TypeScript type definitions updated (`types/database.ts`)
- ✅ 2 — Checkpoint: schema + types verified

**Service Layer**
- ✅ 3.1 — `WorkspaceService` (`lib/db/services/workspace-service.ts`)
  - CRUD + getWorkspaceWithSchemas / getWorkspaceWithJobs / getWorkspaceWithRelations
  - Pagination, filtering, error handling
- ✅ 3.2 — `SchemaDefinitionService` (`lib/db/services/schema-definition-service.ts`)
  - CRUD, validateTableStructure, parseTables/formatTables, versioning (createNewVersion, listVersions)
- ✅ 3.3 — `GenerationJobService` (`lib/db/services/generation-job-service.ts`)
  - CRUD, full job lifecycle (queueJob, processJob, validateJob, completeJob, failJob)
  - getJobProgress, getJobValidation, getJobWithRelations
- ✅ 3.4 — `VisualTemplateService` (`lib/db/services/visual-template-service.ts`)
  - CRUD, validateLayoutConfig, applyTemplate
- ✅ 3.5 — `MigrationService` (`lib/db/services/migration-service.ts`)
  - migrateProjects, migrateSchemas, migrateJobs, cleanupDeprecatedModels
  - validateMigration, rollbackMigration, getMigrationStatus
- ✅ 4 — Checkpoint: service layer verified

**Database Query Layer**
- ✅ 5.1 — `lib/db/queries.ts` rewritten for new schema
  - Workspace queries (getWorkspaceById, getWorkspacesByUserId, searchWorkspaces, CRUD)
  - SchemaDefinition queries (getSchemasByWorkspace, getSchemaByIdAndVersion, getLatestSchemaByWorkspace)
  - GenerationJob queries (getGenerationJobsByWorkspace, updateGenerationJobStatus)
  - VisualTemplate queries (getTemplatesByUser, getPublicTemplates, getTemplateById)
  - Stats queries (getUserStats, getWorkspaceStats)
- ✅ 5.2 — `lib/db/prisma.ts` verified (singleton, disconnectPrisma, checkDatabaseConnection)

**API Routes**
- ✅ 6.1 — Workspace API (`app/api/workspaces/`)
  - `GET /api/workspaces` — list with filters + pagination
  - `POST /api/workspaces` — create
  - `GET /api/workspaces/[id]` — fetch with relations
  - `PATCH /api/workspaces/[id]` — update
  - `DELETE /api/workspaces/[id]` — delete (cascades)
- ✅ 6.2 — SchemaDefinition API (`app/api/schemas/`)
  - `GET /api/schemas?workspaceId=` — list
  - `POST /api/schemas` — create with table structure validation
  - `GET/PATCH/DELETE /api/schemas/[id]`
  - `GET /api/schemas/[id]/versions` — list versions
  - `POST /api/schemas/[id]/versions` — create new version
- ✅ 6.3 — GenerationJob API (`app/api/jobs/`)
  - `GET /api/jobs?workspaceId=` — list with status filter
  - `POST /api/jobs` — create
  - `GET/PATCH/DELETE /api/jobs/[id]`
  - `PATCH /api/jobs/[id]/progress` — update progress (0–100)
  - `POST /api/jobs/[id]/validate` — trigger validation phase
- ✅ 6.4 — VisualTemplate API (`app/api/templates/`)
  - `GET /api/templates` — list own templates
  - `GET /api/templates?public=true` — list public templates
  - `POST /api/templates` — create with layoutConfig validation
  - `GET/PATCH/DELETE /api/templates/[id]`
- ✅ 7 — Checkpoint: all API routes verified (TypeScript clean)

**Migration Scripts**
- ✅ 8.1 — `scripts/backup-database.ts` — backs up all collections to `backups/<timestamp>/`
- ✅ 8.2 — `scripts/migrate-schema.ts` — runs all 4 migration phases, supports `--skip-cleanup`
- ✅ 8.3 — `scripts/rollback-migration.ts` — drops new collections, restores from backup

**UI Updates**
- ✅ 9.1 — Dashboard updated: Workspace terminology, live stats, API endpoint reference
- ✅ 9.2 — Job monitoring UI updated (dashboard stats show generation job counts + success rate)

**Seed Data**
- ✅ `lib/db/seed.ts` rewritten for new schema (3 users, 3 workspaces, 2 schemas, 3 jobs, 1 validation, 2 templates)

---

## 🔜 Active Spec — Phase 2.1: Workspace Schema Designer

**Status**: In Progress — Tasks 3.1, 2.1, 3.2, and 4.1 Complete  
**Spec**: `.kiro/specs/workspace-schema-designer/`

### Scope
Adds a navigable Workspace detail page and an interactive Tabular Schema Designer to DataForge. No Prisma schema, API route logic, NextAuth configuration, or middleware changes are required.

### Planned Work

**Shadcn UI Primitives**
- [x] Install via `shadcn` CLI: `tabs`, `card`, `input`, `select`, `slider`, `switch`, `skeleton`, `sonner`
- [x] Register `<Toaster />` in `app/layout.tsx`

**Dashboard Updates**
- [ ] Fetch and render workspace cards server-side (name, description, creation date)
- [ ] "Open Workspace →" link to `/workspace/[id]` per card
- [ ] Empty-state: "You don't have any workspaces yet."
- [ ] Preserve existing stats + API reference panel

**Workspace Detail Page** (`app/(protected)/workspace/[id]/page.tsx`)
- [x] Server component showing workspace name + description
- [x] Shadcn Tabs: Tabular (active), Relational (coming soon), Documents (coming soon)
- [x] Suspense skeleton loaders during fetch
- [x] `notFound()` for invalid ID, non-owner, or 401 access
- [x] Back link to `/dashboard`

**Schema Designer** (`components/modules/schema/schema-designer.tsx`)
- [x] Task 3.1: `"use client"` component scaffold created
  - `UIDataType` union type (20 data types)
  - `ColumnRow` interface
  - `sanitizeColumnName`, `columnRowsToTableStructure`, `colDefToColumnRow` pure helpers
  - All state vars: `schemaName`, `columns`, `existingSchemaId`, `isLoading`, `isSaving`, `loadError`
  - Imports `TableStructure`, `ColumnDefinition`, `ColumnConstraint` from `@/types/database`
  - Passes `tsc --noEmit` cleanly
- [ ] Task 3.2: Full column row UI (inputs, selects, sliders, switches, buttons)
- [ ] Task 4.1: Load existing schema on mount (`GET /api/schemas?workspaceId=`)
- [ ] Task 5.1: Save logic (POST / PATCH with client-side validation and Sonner toasts)
- [ ] 500 KB payload guard before submission

**UIDataType options**: `Name | Email | Phone | Number | Date | Boolean | Custom Regex`

---

## 📁 Project Structure

```
data-forge/
├── app/
│   ├── (auth)/                 # Login / Register pages
│   ├── (protected)/
│   │   └── dashboard/          # Protected dashboard (Workspace overview + stats)
│   ├── api/
│   │   ├── auth/               # NextAuth handler
│   │   ├── workspaces/         # Workspace CRUD API
│   │   ├── schemas/            # SchemaDefinition API + versioning
│   │   ├── jobs/               # GenerationJob API + progress + validate
│   │   └── templates/          # VisualTemplate API
│   └── layout.tsx / page.tsx / globals.css
│
├── components/
│   ├── forms/                  # Login + Register forms
│   ├── ui/                     # Shadcn UI primitives
│   ├── shared/                 # Shared layout components
│   └── modules/                # Domain-specific components (schema/ planned for Phase 2.1)
│
├── lib/
│   ├── auth/
│   │   ├── actions.ts          # signIn / signOut server actions
│   │   └── session.ts          # getCurrentUser helper
│   ├── db/
│   │   ├── prisma.ts           # Prisma singleton
│   │   ├── queries.ts          # Reusable query helpers
│   │   ├── seed.ts             # Demo data seed
│   │   └── services/
│   │       ├── workspace-service.ts
│   │       ├── schema-definition-service.ts
│   │       ├── generation-job-service.ts
│   │       ├── visual-template-service.ts
│   │       └── migration-service.ts
│   └── utils.ts
│
├── scripts/
│   ├── backup-database.ts      # Pre-migration backup
│   ├── migrate-schema.ts       # Full migration execution
│   └── rollback-migration.ts   # Restore from backup
│
├── prisma/
│   └── schema.prisma           # HackDataV2 schema (7 models + NextAuth tables, 4 enums)
│
├── types/
│   ├── database.ts             # Prisma payload types + interfaces
│   └── next-auth.d.ts          # NextAuth type augmentation
│
└── middleware.ts               # Protected route enforcement
```

---

## 🗄️ Database Schema (Current)

### Enums
| Enum | Values |
|------|--------|
| `UserRole` | USER, ADMIN, DEVELOPER |
| `JobStatus` | QUEUED, PROCESSING, VALIDATING, COMPLETED, FAILED |
| `DataType` | TABULAR, RELATIONAL, DOCUMENT |
| `ExportFormat` | CSV, JSON, SQL, PDF, ZIP |

### Models
| Model | Collection | Key Fields |
|-------|-----------|-----------|
| `User` | `users` | id, email, role (UserRole), workspaces, visualTemplates |
| `Workspace` | `workspaces` | id, name, userId, schemaDefinitions, generationJobs |
| `SchemaDefinition` | `schema_definitions` | id, workspaceId, name, dataType (DataType), tables (JSON), version |
| `GenerationJob` | `generation_jobs` | id, workspaceId, schemaId, status (JobStatus), progress, seed, locale, healthCheckPassed, validationErrors |
| `ValidationResult` | `validation_results` | id, jobId, summary, isPassed, errors (JSON) |
| `VisualTemplate` | `visual_templates` | id, userId, name, category, layoutConfig (JSON), isPublic |
| `Account` / `Session` / `VerificationToken` | NextAuth tables | — |

### Relationships
```
User (1:N) → Workspace
User (1:N) → VisualTemplate
Workspace (1:N) → SchemaDefinition
Workspace (1:N) → GenerationJob
SchemaDefinition (1:N) → GenerationJob
GenerationJob (1:N) → ValidationResult
```

---

## 🚀 Getting Started

### Prerequisites
- Node.js 20+
- MongoDB (local or Atlas)
- npm

### Setup
```bash
npm install

# Copy env template and set DATABASE_URL + AUTH_SECRET
cp .env.example .env.local

# Generate Prisma client
npm run db:generate

# Push schema to MongoDB
npm run db:push

# Seed demo data
npm run db:seed

# Start dev server
npm run dev
```

### Migration (existing database)
```bash
# 1. Back up first
npx tsx scripts/backup-database.ts

# 2. Run migration
npx tsx scripts/migrate-schema.ts

# 3. Rollback if needed
npx tsx scripts/rollback-migration.ts <backupTimestamp>
```

---

## 📝 Available Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start development server |
| `npm run build` | Build for production |
| `npm run lint` | Run ESLint |
| `npm run db:generate` | Generate Prisma Client |
| `npm run db:push` | Push schema to MongoDB |
| `npm run db:seed` | Seed demo data |
| `npm run db:studio` | Open Prisma Studio |
| `npm run db:reset` | Force-reset database (destructive) |

---

## 🎯 Next Phases

### Phase 2.1: Workspace Schema Designer (In Progress — Task 3.1 Complete)
- [x] **Task 1**: Shadcn primitives installed: tabs, card, input, select, slider, switch, skeleton, sonner (+ button)
- [x] **Task 3.1**: `SchemaDesigner` component scaffold — `UIDataType`, `ColumnRow`, `sanitizeColumnName`, `columnRowsToTableStructure`, `colDefToColumnRow`, all state vars, clean `tsc --noEmit`
- [x] **Task 2.1**: Workspace detail page — server component, tabs shell, Suspense skeleton, `notFound()` guard, back link (`app/(protected)/workspace/[id]/page.tsx`)
- [x] **Task 3.2**: Full column row UI — schema name input, mapped column rows with `<Input>` / `<Select>` / `<Slider>` / `<Switch>` / reorder (ArrowUp/Down) / delete (Trash2) buttons, empty state card, single-PK enforcement, `handleAddColumn` / `handleDeleteColumn` / `handleMoveUp` / `handleMoveDown` / `handleColumnChange` handlers, loading/error placeholders for tasks 4.1/5.1, clean `tsc --noEmit`
- [ ] Task 4.1: Load existing schema on mount
- [ ] Task 5.1: Save schema logic
- [ ] Task 6: Sanitization / validation correctness verification
- [ ] Task 7.1: Dashboard workspace cards with navigation
- [ ] Task 8: Final TypeScript + lint checkpoint

### Phase 2.2+: Relational & Document Designers (Proposed)
- [ ] Drag-and-drop relationship builder for RELATIONAL type
- [ ] Document layout editor for DOCUMENT type
- [ ] Schema import from JSON / SQL DDL

### Phase 3: Generation Engine (Proposed)
- [ ] Faker.js integration for realistic data synthesis
- [ ] Per-column type + constraint enforcement
- [ ] Bulk export (CSV, JSON, SQL)

### Phase 4: Template System (Proposed)
- [ ] PDF rendering from VisualTemplate layouts
- [ ] Template marketplace (public sharing)
- [ ] Real-time preview

---

## 🐛 Known Issues

None. TypeScript compilation is clean (`tsc --noEmit` exits 0).

---

## 📄 License

Private — All Rights Reserved
