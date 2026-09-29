/**
 * BullMQ queue client shared by the Next.js app (producer) and the worker.
 */

import { Queue } from "bullmq";
import IORedis, { type RedisOptions } from "ioredis";

export const GENERATION_QUEUE_NAME = "generation-jobs";

export const GENERATE_JOB = "generate";
export const SWEEP_ORPHANS_JOB = "sweep-orphaned-exports";

export interface GenerateJobPayload {
  jobId: string;
  userId: string;
}

export type GenerationQueuePayload = GenerateJobPayload | Record<string, never>;

export class QueueError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QueueError";
  }
}

/**
 * Workers must block on Redis indefinitely (maxRetriesPerRequest: null), while
 * producers should fail fast so an API request never hangs on a Redis outage.
 */
export function createRedisConnection(role: "worker" | "producer"): IORedis {
  const url = process.env.REDIS_URL;
  if (!url) {
    throw new QueueError("REDIS_URL is not configured");
  }

  const options: RedisOptions =
    role === "worker"
      ? { maxRetriesPerRequest: null }
      : { maxRetriesPerRequest: 1, connectTimeout: 5_000 };

  return new IORedis(url, options);
}

const globalForQueue = globalThis as typeof globalThis & {
  generationQueue?: Queue<GenerationQueuePayload>;
};

/** Lazily-created singleton (survives Next.js hot reloads in development). */
export function getGenerationQueue(): Queue<GenerationQueuePayload> {
  globalForQueue.generationQueue ??= new Queue<GenerationQueuePayload>(
    GENERATION_QUEUE_NAME,
    { connection: createRedisConnection("producer") }
  );
  return globalForQueue.generationQueue;
}

/**
 * Adds a generation job to the queue. The DB job id doubles as the BullMQ job
 * id, so enqueueing the same job twice is a no-op.
 */
export async function enqueueGenerationJob(payload: GenerateJobPayload): Promise<void> {
  await getGenerationQueue().add(GENERATE_JOB, payload, {
    jobId: payload.jobId,
    // processJob records its own failures; retries only cover crashes/infra errors
    attempts: 3,
    backoff: { type: "exponential", delay: 5_000 },
    removeOnComplete: { age: 24 * 60 * 60, count: 1_000 },
    removeOnFail: { age: 7 * 24 * 60 * 60 },
  });
}

/** Drops a job that hasn't started yet. Active jobs are left to the worker. */
export async function removeQueuedJob(jobId: string): Promise<void> {
  await getGenerationQueue().remove(jobId);
}
