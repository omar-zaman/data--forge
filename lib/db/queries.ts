/**
 * Database Query Helpers
 * Reusable query functions for common database operations.
 * Updated for the HackDataV2 schema (Workspace, SchemaDefinition, VisualTemplate).
 */

import prisma from "./prisma";
import type {
  Workspace,
  WorkspaceWithRelations,
  GenerationJob,
  VisualTemplate,
  PaginationParams,
  PaginatedResponse,
  WorkspaceFilters,
  GenerationJobFilters,
  TemplateFilters,
} from "@/types/database";
import { Prisma } from "@prisma/client";
import { JobStatus } from "@prisma/client";

// ============================================
// User Queries
// ============================================

export async function getUserById(id: string) {
  return await prisma.user.findUnique({
    where: { id },
    include: {
      workspaces: {
        orderBy: { updatedAt: "desc" },
        take: 5,
      },
    },
  });
}

export async function getUserByEmail(email: string) {
  return await prisma.user.findUnique({
    where: { email },
  });
}

export async function createUser(data: Prisma.UserCreateInput) {
  return await prisma.user.create({ data });
}

// ============================================
// Workspace Queries
// ============================================

export async function getWorkspaceById(
  id: string
): Promise<WorkspaceWithRelations | null> {
  return await prisma.workspace.findUnique({
    where: { id },
    include: {
      user: true,
      schemaDefinitions: {
        orderBy: { version: "desc" },
        take: 1,
      },
      generationJobs: {
        orderBy: { createdAt: "desc" },
        take: 5,
      },
    },
  });
}

export async function getWorkspacesByUserId(
  userId: string,
  pagination?: PaginationParams
): Promise<PaginatedResponse<Workspace>> {
  const page = pagination?.page ?? 1;
  const limit = pagination?.limit ?? 10;
  const skip = (page - 1) * limit;

  const [data, total] = await Promise.all([
    prisma.workspace.findMany({
      where: { userId },
      skip,
      take: limit,
      orderBy: {
        [pagination?.sortBy ?? "updatedAt"]: pagination?.sortOrder ?? "desc",
      },
    }),
    prisma.workspace.count({ where: { userId } }),
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
}

export async function searchWorkspaces(
  filters: WorkspaceFilters,
  pagination?: PaginationParams
): Promise<PaginatedResponse<Workspace>> {
  const page = pagination?.page ?? 1;
  const limit = pagination?.limit ?? 10;
  const skip = (page - 1) * limit;

  const where: Prisma.WorkspaceWhereInput = {
    ...(filters.userId && { userId: filters.userId }),
    ...(filters.search && {
      OR: [
        { name: { contains: filters.search, mode: "insensitive" } },
        { description: { contains: filters.search, mode: "insensitive" } },
      ],
    }),
    ...(filters.dateFrom && { createdAt: { gte: filters.dateFrom } }),
    ...(filters.dateTo && { createdAt: { lte: filters.dateTo } }),
  };

  const [data, total] = await Promise.all([
    prisma.workspace.findMany({
      where,
      skip,
      take: limit,
      include: { user: true },
      orderBy: {
        [pagination?.sortBy ?? "updatedAt"]: pagination?.sortOrder ?? "desc",
      },
    }),
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
}

export async function createWorkspace(data: Prisma.WorkspaceCreateInput) {
  return await prisma.workspace.create({ data, include: { user: true } });
}

export async function updateWorkspace(
  id: string,
  data: Prisma.WorkspaceUpdateInput
) {
  return await prisma.workspace.update({ where: { id }, data });
}

export async function deleteWorkspace(id: string) {
  return await prisma.workspace.delete({ where: { id } });
}

// ============================================
// SchemaDefinition Queries
// ============================================

export async function getSchemasByWorkspace(workspaceId: string) {
  return await prisma.schemaDefinition.findMany({
    where: { workspaceId },
    orderBy: [{ name: "asc" }, { version: "desc" }],
  });
}

export async function getSchemaByIdAndVersion(
  workspaceId: string,
  name: string,
  version: number
) {
  return await prisma.schemaDefinition.findFirst({
    where: { workspaceId, name, version },
  });
}

export async function getLatestSchemaByWorkspace(workspaceId: string) {
  return await prisma.schemaDefinition.findFirst({
    where: { workspaceId },
    orderBy: { version: "desc" },
  });
}

export async function createSchemaDefinition(
  data: Prisma.SchemaDefinitionCreateInput
) {
  return await prisma.schemaDefinition.create({ data });
}

// ============================================
// Generation Job Queries
// ============================================

export async function getGenerationJobsByWorkspace(
  workspaceId: string,
  filters?: GenerationJobFilters,
  pagination?: PaginationParams
): Promise<PaginatedResponse<GenerationJob>> {
  const page = pagination?.page ?? 1;
  const limit = pagination?.limit ?? 10;
  const skip = (page - 1) * limit;

  const where: Prisma.GenerationJobWhereInput = {
    workspaceId,
    ...(filters?.status?.length && { status: { in: filters.status } }),
    ...(filters?.schemaId && { schemaId: filters.schemaId }),
    ...(filters?.dateFrom && { createdAt: { gte: filters.dateFrom } }),
    ...(filters?.dateTo && { createdAt: { lte: filters.dateTo } }),
  };

  const [data, total] = await Promise.all([
    prisma.generationJob.findMany({
      where,
      skip,
      take: limit,
      include: { validationResults: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.generationJob.count({ where }),
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
}

export async function createGenerationJob(
  data: Prisma.GenerationJobCreateInput
) {
  return await prisma.generationJob.create({ data });
}

export async function updateGenerationJobStatus(
  id: string,
  status: JobStatus,
  progress?: number
) {
  return await prisma.generationJob.update({
    where: { id },
    data: {
      status,
      ...(progress !== undefined && { progress }),
    },
  });
}

// ============================================
// VisualTemplate Queries
// ============================================

export async function getTemplatesByUser(
  userId: string,
  filters?: TemplateFilters,
  pagination?: PaginationParams
): Promise<PaginatedResponse<VisualTemplate>> {
  const page = pagination?.page ?? 1;
  const limit = pagination?.limit ?? 10;
  const skip = (page - 1) * limit;

  const where: Prisma.VisualTemplateWhereInput = {
    userId,
    ...(filters?.category && { category: filters.category }),
    ...(filters?.isPublic !== undefined && { isPublic: filters.isPublic }),
    ...(filters?.search && {
      name: { contains: filters.search, mode: "insensitive" },
    }),
  };

  const [data, total] = await Promise.all([
    prisma.visualTemplate.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: "desc" },
    }),
    prisma.visualTemplate.count({ where }),
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
}

export async function getPublicTemplates(
  filters?: TemplateFilters,
  pagination?: PaginationParams
): Promise<PaginatedResponse<VisualTemplate>> {
  const page = pagination?.page ?? 1;
  const limit = pagination?.limit ?? 10;
  const skip = (page - 1) * limit;

  const where: Prisma.VisualTemplateWhereInput = {
    isPublic: true,
    ...(filters?.category && { category: filters.category }),
    ...(filters?.search && {
      name: { contains: filters.search, mode: "insensitive" },
    }),
  };

  const [data, total] = await Promise.all([
    prisma.visualTemplate.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: "desc" },
    }),
    prisma.visualTemplate.count({ where }),
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
}

export async function getTemplateById(id: string) {
  return await prisma.visualTemplate.findUnique({ where: { id } });
}

// ============================================
// Statistics Queries
// ============================================

export async function getUserStats(userId: string) {
  const [workspaceCount, totalJobs, completedJobs] = await Promise.all([
    prisma.workspace.count({ where: { userId } }),
    prisma.generationJob.count({
      where: { workspace: { userId } },
    }),
    prisma.generationJob.count({
      where: {
        workspace: { userId },
        status: JobStatus.COMPLETED,
      },
    }),
  ]);

  return {
    workspaceCount,
    totalJobs,
    completedJobs,
    successRate: totalJobs > 0 ? (completedJobs / totalJobs) * 100 : 0,
  };
}

export async function getWorkspaceStats(workspaceId: string) {
  const [schemaCount, jobCount] = await Promise.all([
    prisma.schemaDefinition.count({ where: { workspaceId } }),
    prisma.generationJob.count({ where: { workspaceId } }),
  ]);

  return {
    schemaCount,
    jobCount,
  };
}
