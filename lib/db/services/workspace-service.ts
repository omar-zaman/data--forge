/**
 * WorkspaceService
 * CRUD and relation-query operations for the Workspace model.
 */

import prisma from "@/lib/db/prisma";
import type {
  Workspace,
  WorkspaceWithRelations,
  WorkspaceWithSchemas,
  WorkspaceWithJobs,
  CreateWorkspaceInput,
  UpdateWorkspaceInput,
  WorkspaceFilters,
  PaginationParams,
  PaginatedResponse,
} from "@/types/database";
import { Prisma } from "@prisma/client";
import { isValidObjectId } from "@/lib/utils/validate-object-id";
import { deleteWorkspaceExports } from "@/lib/engine/exporter";
import { removeQueuedJob } from "@/lib/queue/client";

// ============================================
// CRUD Operations
// ============================================

/**
 * Create a new workspace.
 */
export async function createWorkspace(
  data: CreateWorkspaceInput
): Promise<Workspace> {
  try {
    return await prisma.workspace.create({ data });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new Error(`Failed to create workspace: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Retrieve a single workspace by ID.
 * Returns null when not found.
 */
export async function getWorkspace(id: string): Promise<Workspace | null> {
  try {
    return await prisma.workspace.findUnique({ where: { id } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new Error(`Failed to fetch workspace: ${error.message}`);
    }
    throw error;
  }
}

/**
 * List workspaces with optional filtering and pagination.
 */
export async function listWorkspaces(
  filters?: WorkspaceFilters,
  pagination?: PaginationParams
): Promise<PaginatedResponse<Workspace>> {
  const page = pagination?.page ?? 1;
  const limit = pagination?.limit ?? 10;
  const skip = (page - 1) * limit;

  const where: Prisma.WorkspaceWhereInput = {
    ...(filters?.userId && { userId: filters.userId }),
    ...(filters?.search && {
      OR: [
        { name: { contains: filters.search, mode: "insensitive" } },
        { description: { contains: filters.search, mode: "insensitive" } },
      ],
    }),
    ...(filters?.dateFrom && { createdAt: { gte: filters.dateFrom } }),
    ...(filters?.dateTo && { createdAt: { lte: filters.dateTo } }),
  };

  const orderBy: Prisma.WorkspaceOrderByWithRelationInput = {
    [pagination?.sortBy ?? "updatedAt"]: pagination?.sortOrder ?? "desc",
  };

  try {
    const [data, total] = await Promise.all([
      prisma.workspace.findMany({ where, skip, take: limit, orderBy }),
      prisma.workspace.count({ where }),
    ]);

    return {
      data,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new Error(`Failed to list workspaces: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Update a workspace by ID.
 * Throws if the workspace does not exist.
 */
export async function updateWorkspace(
  id: string,
  data: UpdateWorkspaceInput
): Promise<Workspace> {
  try {
    return await prisma.workspace.update({ where: { id }, data });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2025") {
        throw new Error(`Workspace with id "${id}" not found.`);
      }
      throw new Error(`Failed to update workspace: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Delete a workspace by ID along with its jobs, validation results and
 * schema definitions. Children are removed explicitly (jobs before schemas)
 * because GenerationJob.schema is `onDelete: Restrict`, which can otherwise
 * block the emulated cascade from Workspace → SchemaDefinition.
 * Also removes the workspace's export files from the storage bucket.
 * Throws if the workspace does not exist.
 */
export async function deleteWorkspace(id: string): Promise<Workspace> {
  try {
    const jobs = await prisma.generationJob.findMany({
      where: { workspaceId: id },
      select: { id: true },
    });
    const jobIds = jobs.map((j) => j.id);

    const [, , , deleted] = await prisma.$transaction([
      prisma.validationResult.deleteMany({ where: { jobId: { in: jobIds } } }),
      prisma.generationJob.deleteMany({ where: { workspaceId: id } }),
      prisma.schemaDefinition.deleteMany({ where: { workspaceId: id } }),
      prisma.workspace.delete({ where: { id } }),
    ]);

    // Storage cleanup runs after the DB delete so a failure here never leaves
    // live jobs pointing at missing files; leftovers are caught by the worker's
    // orphan sweep. Queued jobs are skipped by the worker once their record is gone.
    await Promise.allSettled(jobIds.map((jobId) => removeQueuedJob(jobId)));
    await deleteWorkspaceExports(id).catch((storageError) => {
      console.error(`[workspaces] Failed to delete exports for workspace ${id}:`, storageError);
    });

    return deleted;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2025") {
        throw new Error(`Workspace with id "${id}" not found.`);
      }
      throw new Error(`Failed to delete workspace: ${error.message}`);
    }
    throw error;
  }
}

// ============================================
// Relation Queries
// ============================================

/**
 * Retrieve a workspace together with its schema definitions.
 * Returns null when not found.
 */
export async function getWorkspaceWithSchemas(
  id: string
): Promise<WorkspaceWithSchemas | null> {
  try {
    return await prisma.workspace.findUnique({
      where: { id },
      include: { schemaDefinitions: true },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new Error(
        `Failed to fetch workspace with schemas: ${error.message}`
      );
    }
    throw error;
  }
}

/**
 * Retrieve a workspace (with its schema definitions) only if it is owned by
 * `userId`. Ownership is enforced in the query itself, so a workspace that
 * exists but belongs to another user is indistinguishable from a missing one.
 * Returns null for malformed ids, missing workspaces, and non-owned workspaces.
 */
export async function getWorkspaceById(
  id: string,
  userId: string
): Promise<WorkspaceWithSchemas | null> {
  // MongoDB rejects malformed ObjectIds with an error rather than a miss
  if (!isValidObjectId(id)) return null;

  try {
    return await prisma.workspace.findFirst({
      where: { id, userId },
      include: {
        schemaDefinitions: {
          orderBy: [{ name: "asc" }, { version: "desc" }],
        },
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new Error(`Failed to fetch workspace: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Retrieve a workspace together with its generation jobs.
 * Returns null when not found.
 */
export async function getWorkspaceWithJobs(
  id: string
): Promise<WorkspaceWithJobs | null> {
  try {
    return await prisma.workspace.findUnique({
      where: { id },
      include: { generationJobs: true },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new Error(
        `Failed to fetch workspace with jobs: ${error.message}`
      );
    }
    throw error;
  }
}

/**
 * Retrieve a workspace with its schemaDefinitions and generationJobs.
 * The owning user is deliberately NOT included: this result is returned by the
 * API and the User record carries the bcrypt password hash.
 * Returns null when not found.
 */
export async function getWorkspaceWithRelations(
  id: string
): Promise<WorkspaceWithRelations | null> {
  try {
    return await prisma.workspace.findUnique({
      where: { id },
      include: {
        schemaDefinitions: true,
        generationJobs: true,
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new Error(
        `Failed to fetch workspace with relations: ${error.message}`
      );
    }
    throw error;
  }
}
