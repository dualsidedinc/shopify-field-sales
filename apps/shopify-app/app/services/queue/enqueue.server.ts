import { prisma } from "@field-sales/database";
import type { QueueJobKind } from "@prisma/client";
import { getQueue, KIND_PROFILES } from "./queue.server";

export interface EnqueueJobInput {
  kind: QueueJobKind;
  topic: string;
  /** Resolved shop id, if known at enqueue time. */
  shopId?: string | null;
  /**
   * Natural dedup key. Pass when you have one (Shopify event id, request
   * hash, batch id) — duplicate enqueues with the same (kind, topic, key)
   * are no-ops at the QueueJob level AND the BullMQ level.
   */
  idempotencyKey?: string | null;
  payload: unknown;
  /** Free-form: webhook topic, route name, "manual:admin", etc. */
  source?: string;
}

export interface EnqueueResult {
  /** The QueueJob row id. */
  jobId: string;
  /** True when this was a fresh enqueue; false when the dedup key matched an existing job. */
  created: boolean;
}

/**
 * Public entry point for queueing async work.
 *
 * Flow:
 *   1. Upsert a QueueJob row (durable audit + dedup).
 *   2. Add a BullMQ job keyed by the QueueJob id.
 *
 * Idempotent on (kind, topic, idempotencyKey) — calling twice with the same
 * tuple returns the existing job without enqueueing again.
 */
export async function enqueueJob(input: EnqueueJobInput): Promise<EnqueueResult> {
  const { kind, topic, shopId, idempotencyKey, payload, source } = input;

  // Step 1: upsert the QueueJob row. The unique index on
  // (kind, topic, idempotencyKey) catches duplicates. When idempotencyKey
  // is null, Postgres treats nulls as distinct — so null keys always create
  // new rows (which is the intended behavior for ad-hoc jobs).
  let job;
  let created = false;

  if (idempotencyKey) {
    const existing = await prisma.queueJob.findUnique({
      where: {
        kind_topic_idempotencyKey: { kind, topic, idempotencyKey },
      },
    });

    if (existing) {
      // Already enqueued — short-circuit. Don't re-add to BullMQ either,
      // jobId-based dedup there would catch it but this avoids the round-trip.
      return { jobId: existing.id, created: false };
    }

    job = await prisma.queueJob.create({
      data: {
        kind,
        topic,
        shopId: shopId ?? null,
        idempotencyKey,
        payload: payload as object,
        source: source ?? null,
      },
    });
    created = true;
  } else {
    job = await prisma.queueJob.create({
      data: {
        kind,
        topic,
        shopId: shopId ?? null,
        payload: payload as object,
        source: source ?? null,
      },
    });
    created = true;
  }

  // Step 2: enqueue in BullMQ keyed by the QueueJob row id. Worker pulls
  // by id and loads the row to get the full payload + status tracking.
  const profile = KIND_PROFILES[kind];
  await getQueue(kind).add(
    topic,
    { queueJobId: job.id },
    {
      jobId: job.id, // BullMQ dedup as a second line of defense
      attempts: profile.attempts,
      backoff: { type: "exponential", delay: profile.backoffMs },
    }
  );

  return { jobId: job.id, created };
}
