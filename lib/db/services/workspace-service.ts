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
 * Delete a workspace by ID.
 * Cascades to associated schemaDefinitions and generationJobs per schema rules.
 * Throws if the workspace does not exist.
 */
export async function deleteWorkspace(id: string): Promise<Workspace> {
  try {
    return await prisma.workspace.delete({ where: { id } });
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
 * Retrieve a workspace with all relations (user, schemaDefinitions, generationJobs).
 * Returns null when not found.
 */
export async function getWorkspaceWithRelations(
  id: string
): Promise<WorkspaceWithRelations | null> {
  try {
    return await prisma.workspace.findUnique({
      where: { id },
      include: {
        user: true,
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
