import type { QueueJob, QueueJobKind } from "@prisma/client";

/**
 * Handler signature: receives the full QueueJob row and runs the actual
 * work. Should throw on failure — BullMQ will retry per the kind's profile.
 */
export type JobHandler = (job: QueueJob) => Promise<void>;

/**
 * Registry of (kind, topic) → handler. Populated at worker startup by
 * importing each kind's handler module, which calls `registerHandler`.
 *
 * Topic matching:
 *   1. Exact match first (`"orders/paid"`).
 *   2. Wildcard fallback (`"*"`) for catch-all handlers per kind.
 */
const handlers: Partial<Record<QueueJobKind, Map<string, JobHandler>>> = {};

export function registerHandler(
  kind: QueueJobKind,
  topic: string,
  handler: JobHandler
): void {
  if (!handlers[kind]) {
    handlers[kind] = new Map();
  }
  if (handlers[kind]!.has(topic)) {
    throw new Error(`Handler already registered for ${kind}:${topic}`);
  }
  handlers[kind]!.set(topic, handler);
}

export function getHandler(kind: QueueJobKind, topic: string): JobHandler | null {
  const kindHandlers = handlers[kind];
  if (!kindHandlers) return null;
  return kindHandlers.get(topic) ?? kindHandlers.get("*") ?? null;
}

/**
 * Runs the handler matched for this job. Throws if no handler is registered
 * — callers (the worker) treat this as a permanent failure since auto-retry
 * won't help.
 */
export async function dispatchJob(job: QueueJob): Promise<void> {
  const handler = getHandler(job.kind, job.topic);
  if (!handler) {
    throw new Error(
      `No handler registered for ${job.kind}:${job.topic} (job ${job.id})`
    );
  }
  await handler(job);
}
