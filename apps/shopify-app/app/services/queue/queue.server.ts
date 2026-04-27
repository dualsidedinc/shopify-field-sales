import { Queue } from "bullmq";
import IORedis from "ioredis";
import type { QueueJobKind } from "@prisma/client";

/**
 * BullMQ wiring. One queue per QueueJobKind so each can have its own
 * concurrency, rate limit, and retry policy. The QueueJob row in Postgres
 * is the durable record; BullMQ jobs are the in-flight processing layer.
 */

// Lazy singleton — Redis connection only opens on first use, so import-time
// in serverless cold starts stays cheap.
let redisConnection: IORedis | null = null;

export function getRedisConnection(): IORedis {
  if (!redisConnection) {
    const url = process.env.REDIS_URL;
    if (!url) {
      throw new Error("REDIS_URL is required for the job queue");
    }
    redisConnection = new IORedis(url, {
      maxRetriesPerRequest: null, // BullMQ requires this
      enableReadyCheck: false,
    });
  }
  return redisConnection;
}

// Default options applied to every job. Per-kind options layer on top in
// the worker.
const DEFAULT_JOB_OPTIONS = {
  removeOnComplete: { count: 100, age: 60 * 60 }, // keep last 100 / past hour
  removeOnFail: { count: 500, age: 7 * 24 * 60 * 60 }, // keep last 500 / past 7d
};

const queues: Partial<Record<QueueJobKind, Queue>> = {};

export function getQueue(kind: QueueJobKind): Queue {
  if (!queues[kind]) {
    queues[kind] = new Queue(`queue:${kind}`, {
      connection: getRedisConnection(),
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    });
  }
  return queues[kind]!;
}

/**
 * Operational profile per kind. Used by the worker to instantiate Workers
 * with appropriate concurrency + retry behavior.
 */
export const KIND_PROFILES: Record<QueueJobKind, {
  concurrency: number;
  attempts: number;
  backoffMs: number;
}> = {
  WEBHOOK:     { concurrency: 25, attempts: 5,  backoffMs: 1_000 },     // fast retries, high concurrency
  API:         { concurrency: 8,  attempts: 10, backoffMs: 5_000 },     // slower retries to respect external rate limits
  FILE_IMPORT: { concurrency: 2,  attempts: 1,  backoffMs: 0 },         // no auto-retry; failed = needs admin attention
  ACTION:      { concurrency: 3,  attempts: 3,  backoffMs: 30_000 },    // scheduled work; long backoff
};
