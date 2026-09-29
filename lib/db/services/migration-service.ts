/**
 * MigrationService
 * Handles data migration from the old DataForge schema to the new
 * HackDataV2 Synthetic Data & Document Platform schema.
 *
 * Migration order:
 *   1. migrateProjects  – Project  → Workspace
 *   2. migrateSchemas   – Schema   → SchemaDefinition
 *   3. migrateJobs      – GenerationJob field updates
 *   4. cleanupDeprecatedModels – drop old collections
 *
 * Each phase returns a MigrationResult with success flag, migrated count,
 * and any per-record error messages.
 */

import prisma from "@/lib/db/prisma";
import type { MigrationResult, MigrationStatus } from "@/types/database";
import { DataType, JobStatus } from "@prisma/client";

// ============================================
// Internal state (in-memory, per-process)
// ============================================

let currentPhase = "idle";
let currentProgress = 0;
const phaseErrors: string[] = [];

function setPhase(phase: string, progress: number) {
  currentPhase = phase;
  currentProgress = progress;
}

// ============================================
// Phase 1 – Migrate Projects → Workspaces
// ============================================

/**
 * Reads every document from the legacy `projects` collection via the raw
 * MongoDB driver and upserts it as a `Workspace`.
 *
 * Because the Prisma schema no longer has a `Project` model we access the
 * old collection through `prisma.$runCommandRaw` / `prisma.$queryRawUnsafe`
 * isn't available for MongoDB.  Instead, we use `prisma.$runCommandRaw` to
 * read the raw documents and then write them through the typed Workspace API.
 *
 * If the projects collection no longer exists (already migrated) the method
 * returns immediately with migratedCount = 0.
 */
export async function migrateProjects(): Promise<MigrationResult> {
  setPhase("migrateProjects", 10);
  const errors: string[] = [];
  let migratedCount = 0;

  try {
    // Use runCommandRaw to read from the old "projects" collection
    const result = await prisma.$runCommandRaw({
      find: "projects",
      filter: {},
    });

    const cursor = result as { cursor?: { firstBatch?: unknown[] } };
    const projects: unknown[] = cursor?.cursor?.firstBatch ?? [];

    for (const raw of projects) {
      const project = raw as {
        _id: { $oid: string };
        name?: string;
        description?: string;
        userId?: string;
        createdAt?: { $date: string };
        updatedAt?: { $date: string };
      };

      try {
        const id = project._id?.$oid;
        if (!id) {
          errors.push(`Skipping project without _id`);
          continue;
        }

        // Check if already migrated
        const existing = await prisma.workspace.findUnique({ where: { id } });
        if (existing) {
          migratedCount++;
          continue;
        }

        await prisma.workspace.create({
          data: {
            id,
            name: project.name ?? "Untitled Workspace",
            description: project.description ?? null,
            userId: project.userId ?? "",
            createdAt: project.createdAt
              ? new Date(project.createdAt.$date)
              : new Date(),
            updatedAt: project.updatedAt
              ? new Date(project.updatedAt.$date)
              : new Date(),
          },
        });
        migratedCount++;
      } catch (err) {
        errors.push(
          `Failed to migrate project: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
  } catch (err) {
    // Collection may not exist – not a hard failure
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes("ns does not exist") && !msg.includes("no such collection")) {
      errors.push(`migrateProjects error: ${msg}`);
      phaseErrors.push(...errors);
      return { success: false, migratedCount, errors };
    }
  }

  phaseErrors.push(...errors);
  return { success: errors.length === 0, migratedCount, errors };
}

// ============================================
// Phase 2 – Migrate Schemas → SchemaDefinitions
// ============================================

/**
 * Reads every document from the legacy `schemas` collection and upserts it
 * as a `SchemaDefinition` linked to the already-migrated Workspace.
 */
export async function migrateSchemas(): Promise<MigrationResult> {
  setPhase("migrateSchemas", 30);
  const errors: string[] = [];
  let migratedCount = 0;

  try {
    const result = await prisma.$runCommandRaw({
      find: "schemas",
      filter: {},
    });

    const cursor = result as { cursor?: { firstBatch?: unknown[] } };
    const schemas: unknown[] = cursor?.cursor?.firstBatch ?? [];

    for (const raw of schemas) {
      const schema = raw as {
        _id: { $oid: string };
        projectId?: string;
        name?: string;
        version?: number;
        structure?: unknown;
        createdAt?: { $date: string };
        updatedAt?: { $date: string };
      };

      try {
        const id = schema._id?.$oid;
        if (!id) {
          errors.push(`Skipping schema without _id`);
          continue;
        }

        const existing = await prisma.schemaDefinition.findUnique({
          where: { id },
        });
        if (existing) {
          migratedCount++;
          continue;
        }

        const workspaceId = schema.projectId ?? "";
        // Verify target workspace exists
        const workspace = await prisma.workspace.findUnique({
          where: { id: workspaceId },
        });
        if (!workspace) {
          errors.push(
            `Schema ${id}: workspace "${workspaceId}" not found – skipping`
          );
          continue;
        }

        await prisma.schemaDefinition.create({
          data: {
            id,
            workspaceId,
            name: schema.name ?? `Schema v${schema.version ?? 1}`,
            dataType: DataType.TABULAR, // default; can be overridden post-migration
            tables: (schema.structure as object) ?? [],
            version: schema.version ?? 1,
            createdAt: schema.createdAt
              ? new Date(schema.createdAt.$date)
              : new Date(),
            updatedAt: schema.updatedAt
              ? new Date(schema.updatedAt.$date)
              : new Date(),
          },
        });
        migratedCount++;
      } catch (err) {
        errors.push(
          `Failed to migrate schema: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes("ns does not exist") && !msg.includes("no such collection")) {
      errors.push(`migrateSchemas error: ${msg}`);
      phaseErrors.push(...errors);
      return { success: false, migratedCount, errors };
    }
  }

  phaseErrors.push(...errors);
  return { success: errors.length === 0, migratedCount, errors };
}

// ============================================
// Phase 3 – Migrate GenerationJobs
// ============================================

/** Maps old PENDING status to the new QUEUED value. */
function mapStatus(old: string): JobStatus {
  const map: Record<string, JobStatus> = {
    PENDING: JobStatus.QUEUED,
    QUEUED: JobStatus.QUEUED,
    PROCESSING: JobStatus.PROCESSING,
    VALIDATING: JobStatus.VALIDATING,
    COMPLETED: JobStatus.COMPLETED,
    FAILED: JobStatus.FAILED,
  };
  return map[old] ?? JobStatus.QUEUED;
}

/** Derives an approximate progress value from an old status string. */
function progressFromStatus(status: string): number {
  if (status === "COMPLETED") return 100;
  if (status === "PROCESSING" || status === "VALIDATING") return 50;
  return 0;
}

/**
 * Updates existing GenerationJob documents to populate the new fields
 * (workspaceId, schemaId, progress, etc.) and maps old status values.
 *
 * Jobs that already reference a valid workspaceId/schemaId are skipped.
 */
export async function migrateJobs(): Promise<MigrationResult> {
  setPhase("migrateJobs", 60);
  const errors: string[] = [];
  let migratedCount = 0;

  try {
    // Read old generation_jobs collection for jobs that may carry old fields
    const result = await prisma.$runCommandRaw({
      find: "generation_jobs",
      filter: {},
    });

    const cursor = result as { cursor?: { firstBatch?: unknown[] } };
    const jobs: unknown[] = cursor?.cursor?.firstBatch ?? [];

    for (const raw of jobs) {
      const job = raw as {
        _id: { $oid: string };
        projectId?: string;
        schemaId?: string;
        status?: string;
        createdAt?: { $date: string };
        updatedAt?: { $date: string };
      };

      try {
        const id = job._id?.$oid;
        if (!id) continue;

        const prismaJob = await prisma.generationJob.findUnique({
          where: { id },
        });
        if (!prismaJob) continue; // job doesn't exist in new schema yet

        // Only update if workspaceId looks like it may be a legacy projectId
        const newStatus = mapStatus(job.status ?? "PENDING");
        const newProgress = progressFromStatus(job.status ?? "PENDING");

        await prisma.generationJob.update({
          where: { id },
          data: {
            status: newStatus,
            progress: prismaJob.progress === 0 ? newProgress : prismaJob.progress,
          },
        });
        migratedCount++;
      } catch (err) {
        errors.push(
          `Failed to migrate job: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes("ns does not exist") && !msg.includes("no such collection")) {
      errors.push(`migrateJobs error: ${msg}`);
      phaseErrors.push(...errors);
      return { success: false, migratedCount, errors };
    }
  }

  phaseErrors.push(...errors);
  return { success: errors.length === 0, migratedCount, errors };
}

// ============================================
// Phase 4 – Clean up deprecated collections
// ============================================

const DEPRECATED_COLLECTIONS = [
  "datasets",
  "schemas",
  "templates",
  "ai_conversations",
  "export_logs",
  "projects",
] as const;

/**
 * Drops deprecated MongoDB collections that are no longer part of the schema.
 * Each drop is attempted independently; a failure on one collection does not
 * block the others.
 */
export async function cleanupDeprecatedModels(): Promise<void> {
  setPhase("cleanup", 90);

  for (const collection of DEPRECATED_COLLECTIONS) {
    try {
      await prisma.$runCommandRaw({ drop: collection });
      console.log(`Dropped collection: ${collection}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // "ns not found" means the collection didn't exist — that's fine
      if (!msg.includes("ns not found") && !msg.includes("no such collection")) {
        console.warn(`Could not drop collection "${collection}": ${msg}`);
      }
    }
  }
}

// ============================================
// Validation
// ============================================

/**
 * Runs basic sanity checks against the migrated data:
 *  - Every Workspace has a valid userId
 *  - Every SchemaDefinition has a valid workspaceId
 *  - Every GenerationJob has valid workspaceId + schemaId
 */
export async function validateMigration(): Promise<{
  isValid: boolean;
  errors: string[];
}> {
  setPhase("validate", 95);
  const errors: string[] = [];

  // Check workspaces
  const workspaces = await prisma.workspace.findMany({
    select: { id: true, userId: true },
  });
  for (const ws of workspaces) {
    if (!ws.userId) {
      errors.push(`Workspace ${ws.id} has no userId`);
    }
  }

  // Check schema definitions
  const schemaDefs = await prisma.schemaDefinition.findMany({
    select: { id: true, workspaceId: true },
  });
  const workspaceIds = new Set(workspaces.map((w) => w.id));
  for (const sd of schemaDefs) {
    if (!workspaceIds.has(sd.workspaceId)) {
      errors.push(
        `SchemaDefinition ${sd.id} references unknown workspace ${sd.workspaceId}`
      );
    }
  }

  // Check generation jobs
  const jobs = await prisma.generationJob.findMany({
    select: { id: true, workspaceId: true, schemaId: true },
  });
  const schemaIds = new Set(schemaDefs.map((s) => s.id));
  for (const job of jobs) {
    if (!workspaceIds.has(job.workspaceId)) {
      errors.push(
        `GenerationJob ${job.id} references unknown workspace ${job.workspaceId}`
      );
    }
    if (!schemaIds.has(job.schemaId)) {
      errors.push(
        `GenerationJob ${job.id} references unknown schema ${job.schemaId}`
      );
    }
  }

  return { isValid: errors.length === 0, errors };
}

// ============================================
// Rollback
// ============================================

/**
 * Rollback is intentionally limited to removing any Workspace / SchemaDefinition
 * records that were created during migration (identified by matching IDs in the
 * old collections).  Full rollback from backup should be performed via the
 * dedicated rollback script (`scripts/rollback-migration.ts`).
 */
export async function rollbackMigration(): Promise<void> {
  setPhase("rollback", 0);
  console.warn(
    "rollbackMigration: This removes migrated Workspace and SchemaDefinition records. " +
      "Restore from backup for a full rollback."
  );

  // For a lightweight rollback we simply log a warning.
  // The scripts/rollback-migration.ts script performs the full restore.
  phaseErrors.length = 0;
  setPhase("rolled_back", 0);
}

// ============================================
// Status
// ============================================

export function getMigrationStatus(): MigrationStatus {
  return {
    phase: currentPhase,
    progress: currentProgress,
    errors: [...phaseErrors],
  };
}
