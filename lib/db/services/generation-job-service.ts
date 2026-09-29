/**
 * GenerationJobService
 * Job lifecycle operations for the GenerationJob model.
 *
 * Status transitions:
 *   queueJob    → QUEUED      (progress = 0)
 *   processJob  → PROCESSING
 *   validateJob → VALIDATING  (stub validation, creates ValidationResult)
 *   completeJob → COMPLETED   (progress = 100, completedAt = now, exportUrl)
 *   failJob     → FAILED      (validationErrors = errors array)
 */

import prisma from "@/lib/db/prisma";
import type {
  GenerationJob,
  GenerationJobWithRelations,
  GenerationJobFilters,
  ValidationResult,
  ValidationError,
  CreateGenerationJobInput,
  UpdateGenerationJobInput,
  PaginationParams,
  PaginatedResponse,
} from "@/types/database";
import { JobStatus } from "@prisma/client";
import { Prisma } from "@prisma/client";

// ============================================
// CRUD Operations
// ============================================

/**
 * Create a new generation job.
 * The initial status defaults to QUEUED and progress to 0 (schema defaults).
 */
export async function createJob(
  data: CreateGenerationJobInput
): Promise<GenerationJob> {
  try {
    return await prisma.generationJob.create({ data });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new Error(`Failed to create generation job: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Retrieve a single generation job by ID.
 * Returns null when not found.
 */
export async function getJob(id: string): Promise<GenerationJob | null> {
  try {
    return await prisma.generationJob.findUnique({ where: { id } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new Error(`Failed to fetch generation job: ${error.message}`);
    }
    throw error;
  }
}

/**
 * List generation jobs with optional filtering and pagination.
 */
export async function listJobs(
  filters?: GenerationJobFilters,
  pagination?: PaginationParams
): Promise<PaginatedResponse<GenerationJob>> {
  const page = pagination?.page ?? 1;
  const limit = pagination?.limit ?? 10;
  const skip = (page - 1) * limit;

  const where: Prisma.GenerationJobWhereInput = {
    ...(filters?.workspaceId && { workspaceId: filters.workspaceId }),
    ...(filters?.schemaId && { schemaId: filters.schemaId }),
    ...(filters?.status?.length && { status: { in: filters.status } }),
    ...(filters?.dateFrom && { createdAt: { gte: filters.dateFrom } }),
    ...(filters?.dateTo && { createdAt: { lte: filters.dateTo } }),
  };

  const orderBy: Prisma.GenerationJobOrderByWithRelationInput = {
    [pagination?.sortBy ?? "createdAt"]: pagination?.sortOrder ?? "desc",
  };

  try {
    const [data, total] = await Promise.all([
      prisma.generationJob.findMany({ where, skip, take: limit, orderBy }),
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
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new Error(`Failed to list generation jobs: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Generic status + optional progress update.
 * Used internally by the lifecycle methods and exposed for direct callers.
 */
export async function updateJobStatus(
  id: string,
  status: JobStatus,
  progress?: number
): Promise<GenerationJob> {
  try {
    return await prisma.generationJob.update({
      where: { id },
      data: {
        status,
        ...(progress !== undefined && { progress }),
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2025") {
        throw new Error(`Generation job with id "${id}" not found.`);
      }
      throw new Error(`Failed to update job status: ${error.message}`);
    }
    throw error;
  }
}

// ============================================
// Job Lifecycle Operations
// ============================================

/**
 * Place a job in the queue.
 * Sets status → QUEUED and resets progress to 0.
 */
export async function queueJob(id: string): Promise<GenerationJob> {
  return updateJobStatus(id, JobStatus.QUEUED, 0);
}

/**
 * Mark a job as actively processing.
 * Sets status → PROCESSING.
 */
export async function processJob(id: string): Promise<GenerationJob> {
  return updateJobStatus(id, JobStatus.PROCESSING);
}

/**
 * Transition a job to the VALIDATING phase.
 * Creates a stub ValidationResult record for the job.
 */
export async function validateJob(id: string): Promise<GenerationJob> {
  // Ensure the job exists before creating the validation record
  const job = await getJob(id);
  if (!job) {
    throw new Error(`Generation job with id "${id}" not found.`);
  }

  // Create a stub validation result – real validation logic hooks in here
  await prisma.validationResult.create({
    data: {
      jobId: id,
      summary: {},
      isPassed: false,
      errors: [],
    },
  });

  return updateJobStatus(id, JobStatus.VALIDATING);
}

/**
 * Mark a job as successfully completed.
 * Sets status → COMPLETED, progress = 100, records completedAt and exportUrl.
 */
export async function completeJob(
  id: string,
  exportUrl: string
): Promise<GenerationJob> {
  try {
    return await prisma.generationJob.update({
      where: { id },
      data: {
        status: JobStatus.COMPLETED,
        progress: 100,
        completedAt: new Date(),
        exportUrl,
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2025") {
        throw new Error(`Generation job with id "${id}" not found.`);
      }
      throw new Error(`Failed to complete job: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Mark a job as failed and record the validation errors.
 * Sets status → FAILED and persists the errors JSON array.
 */
export async function failJob(
  id: string,
  errors: ValidationError[]
): Promise<GenerationJob> {
  try {
    return await prisma.generationJob.update({
      where: { id },
      data: {
        status: JobStatus.FAILED,
        validationErrors: errors as unknown as Prisma.InputJsonValue,
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2025") {
        throw new Error(`Generation job with id "${id}" not found.`);
      }
      throw new Error(`Failed to mark job as failed: ${error.message}`);
    }
    throw error;
  }
}

// ============================================
// Monitoring
// ============================================

/**
 * Return the current progress (0-100) for a job.
 * Throws if the job does not exist.
 */
export async function getJobProgress(jobId: string): Promise<number> {
  try {
    const job = await prisma.generationJob.findUnique({
      where: { id: jobId },
      select: { progress: true },
    });

    if (!job) {
      throw new Error(`Generation job with id "${jobId}" not found.`);
    }

    return job.progress;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new Error(`Failed to fetch job progress: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Return the most recent ValidationResult for a job, or null if none exists.
 */
export async function getJobValidation(
  jobId: string
): Promise<ValidationResult | null> {
  try {
    return await prisma.validationResult.findFirst({
      where: { jobId },
      orderBy: { createdAt: "desc" },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new Error(`Failed to fetch job validation: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Retrieve a job with all relations (workspace, schema, validationResults).
 * Returns null when not found.
 */
export async function getJobWithRelations(
  id: string
): Promise<GenerationJobWithRelations | null> {
  try {
    return await prisma.generationJob.findUnique({
      where: { id },
      include: {
        workspace: true,
        schema: true,
        validationResults: true,
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new Error(
        `Failed to fetch job with relations: ${error.message}`
      );
    }
    throw error;
  }
}
