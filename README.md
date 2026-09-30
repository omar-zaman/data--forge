# DataForge

DataForge is a full-stack platform for generating **synthetic data and documents**. You define a schema, and DataForge produces realistic, seeded, locale-aware data that is consistent across related tables. It checks the result for integrity, exports it, and lets you explore it with built-in analytics.

## Features

- **Workspaces & schema designer**: build tabular, relational or document schemas visually, with a table manager, a foreign-key builder, an ERD visualizer, a live preview canvas and schema versioning.
- **Generation engines** (powered by Faker):
  - *Tabular*: typed columns, null rates, uniqueness, deterministic seeds and locales.
  - *Relational*: multi-table generation with foreign keys and cardinality constraints.
  - *Document*: records rendered into PDFs through configurable visual templates.
- **Background job pipeline**: jobs are queued with BullMQ on Redis and processed by a separate worker, with progress tracking and a job history.
- **Health checks**: an in-memory auditor checks referential integrity, null rates and primary-key/unique constraints while rows stream through the worker.
- **Exports**: CSV, JSON, SQL, PDF and ZIP, stored in S3-compatible storage (AWS S3, Cloudflare R2, MinIO) and downloaded through 24-hour presigned URLs.
- **Analytics dashboard**: profiles generated datasets with categorical bar/pie charts, numeric distributions and a geospatial map of coordinate columns (Recharts + Leaflet).
- **AI assistant**: a Google Gemini assistant that drafts schemas from a plain-language description ("Talk to Schema") and explains validation errors.
- **Template gallery**: reusable visual templates for document output.
- **Auth**: email/password plus GitHub and Google OAuth (NextAuth v5), with protected routes.
- **Light and dark themes**.

## Tech stack

| Area | Technology |
|------|------------|
| Framework | Next.js 16 (App Router), React 19, TypeScript |
| UI | Tailwind CSS v4, shadcn/ui (Radix), Lucide icons, next-themes |
| Data | MongoDB with Prisma ORM |
| Auth | NextAuth.js v5 + Prisma adapter |
| Jobs | BullMQ + Redis (ioredis) |
| Storage | AWS SDK v3 (S3 / R2 / MinIO) |
| Generation | @faker-js/faker, @react-pdf/renderer, archiver |
| Analytics | Recharts, Leaflet / react-leaflet |
| AI | Vercel AI SDK + Google Gemini |

## Getting started

### Prerequisites

- Node.js 20+
- MongoDB running as a **replica set** (Prisma needs this for MongoDB), either local or Atlas
- Redis
- An S3-compatible bucket. For local development, `npm run services` starts Redis and an in-process S3 emulator (s3rver).

### Setup

```bash
npm install
cp .env.example .env.local   # then fill in the values
npm run db:setup             # generate client, push schema, check connection, seed
```

Key environment variables (see [.env.example](.env.example) for the full list):

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | MongoDB connection string |
| `NEXTAUTH_SECRET`, `NEXTAUTH_URL` | NextAuth configuration |
| `GITHUB_CLIENT_ID/SECRET`, `GOOGLE_CLIENT_ID/SECRET` | Optional OAuth providers |
| `REDIS_URL` | BullMQ queue connection |
| `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_REGION`, `S3_ENDPOINT` | Export storage (keep the bucket private) |
| `GEMINI_API_KEY` | AI assistant (free tier key from Google AI Studio) |

### Run

Run each of these in its own terminal:

```bash
npm run services   # optional: local Redis + S3 emulator
npm run dev        # Next.js app at http://localhost:3000
npm run worker     # background generation worker
```

## Scripts

| Script | Description |
|--------|-------------|
| `dev` / `build` / `start` | Next.js development, production build and server |
| `worker` | Starts the BullMQ generation worker |
| `services` | Starts local Redis and the S3 emulator |
| `lint` | Runs ESLint |
| `db:generate` / `db:push` / `db:seed` / `db:studio` | Prisma helpers |
| `db:reset` | Force-resets the database schema |
| `db:check` | Checks the database connection |
| `db:setup` | One-shot database setup |

## Project structure

```
app/
  (auth)/            login and register pages
  (protected)/       dashboard, workspace/[id], templates, settings
  api/               workspaces, schemas, jobs (progress, validate, download, analytics), templates, chat, auth
components/
  modules/           schema, jobs, analytics, documents, templates, workspace, assistant
  ui/                shadcn/ui primitives
lib/
  engine/            tabular, relational and document engines, PDF renderer, auditor, exporter
  queue/             BullMQ client and worker
  storage/           S3 helpers
  analytics/         dataset loading and chart aggregation
  ai/                assistant tools
  db/                Prisma client, queries and services
prisma/schema.prisma
scripts/             dev services, DB check, backup and migration scripts
```
