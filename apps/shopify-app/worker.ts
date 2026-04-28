/**
 * BullMQ worker entry point. Deploy as a separate Render Worker service
 * (or any long-running process). Pulls jobs from the queues and dispatches
 * via the registered handlers.
 *
 * Run: `node ./build/worker.js` (after build) or `tsx worker.ts` in dev.
 */
import { Worker } from "bullmq";
import { prisma } from "@field-sales/database";
import type { QueueJob, QueueJobKind } from "@prisma/client";
import { getRedisConnection, KIND_PROFILES } from "./app/services/queue/queue.server";
import { dispatchJob } from "./app/services/queue/registry.server";
import { registerWebhookHandlers } from "./app/services/queue/handlers/webhooks.server";
import { registerActionHandlers } from "./app/services/queue/handlers/actions.server";
import { installSchedules } from "./app/services/queue/schedules.server";

// ---------------------------------------------------------------------------
// 1. Register every handler. Add new kinds/topics here as they're built.
// ---------------------------------------------------------------------------
registerWebhookHandlers();
registerActionHandlers();
// registerApiHandlers();        // future
// registerFileImportHandlers(); // future

// ---------------------------------------------------------------------------
// 2. Spawn one Worker per kind with its operational profile.
// ---------------------------------------------------------------------------
const KINDS: QueueJobKind[] = ["WEBHOOK", "API", "FILE_IMPORT", "ACTION"];

const workers = KINDS.map((kind) => {
  const profile = KIND_PROFILES[kind];

  const worker = new Worker(
    `queue-${kind}`,
    async (bullJob) => {
      const data = bullJob.data as { queueJobId?: string; topic?: string };

      // Two ways a job arrives:
      //   1. enqueueJob() created a QueueJob row, BullMQ data has queueJobId.
      //   2. A BullMQ Job Scheduler fired (cron) — no row exists yet, data
      //      carries the topic. Create the row on first sight, keyed by the
      //      bullJob id so a retry reuses the same row.
      let job: QueueJob | null = null;
      if (data.queueJobId) {
        job = await prisma.queueJob.findUnique({ where: { id: data.queueJobId } });
        if (!job) {
          console.warn(`[Worker:${kind}] QueueJob ${data.queueJobId} not found, skipping`);
          return;
        }
      } else if (data.topic && bullJob.id) {
        const idempotencyKey = `bullmq:${bullJob.id}`;
        job = await prisma.queueJob.upsert({
          where: { kind_topic_idempotencyKey: { kind, topic: data.topic, idempotencyKey } },
          update: {},
          create: {
            kind,
            topic: data.topic,
            idempotencyKey,
            payload: {},
            source: "schedule",
          },
        });
      } else {
        console.warn(
          `[Worker:${kind}] BullMQ job ${bullJob.id} has no queueJobId or topic, skipping`
        );
        return;
      }

      // Mark PROCESSING + bump attempts. Caller can see in-flight state.
      await prisma.queueJob.update({
        where: { id: job.id },
        data: {
          status: "PROCESSING",
          attempts: { increment: 1 },
          startedAt: job.startedAt ?? new Date(),
        },
      });

      try {
        await dispatchJob(job);

        await prisma.queueJob.update({
          where: { id: job.id },
          data: {
            status: "COMPLETED",
            processedAt: new Date(),
            lastError: null,
          },
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const willRetry = bullJob.attemptsMade < (bullJob.opts.attempts ?? 1);

        await prisma.queueJob.update({
          where: { id: job.id },
          data: {
            status: willRetry ? "QUEUED" : "FAILED",
            lastError: message,
          },
        });

        // Re-throw so BullMQ records the failure + schedules the retry.
        throw err;
      }
    },
    {
      connection: getRedisConnection(),
      concurrency: profile.concurrency,
    }
  );

  worker.on("ready", () => {
    console.log(`[Worker:${kind}] ready (concurrency: ${profile.concurrency})`);
  });
  worker.on("failed", (job, err) => {
    console.error(`[Worker:${kind}] job ${job?.id} failed:`, err.message);
  });
  worker.on("error", (err) => {
    console.error(`[Worker:${kind}] worker error:`, err);
  });

  return worker;
});

// ---------------------------------------------------------------------------
// 3. Graceful shutdown on SIGTERM / SIGINT (Render sends SIGTERM on deploy).
// ---------------------------------------------------------------------------
async function shutdown(signal: string): Promise<void> {
  console.log(`[Worker] received ${signal}, draining workers...`);
  await Promise.all(workers.map((w) => w.close()));
  await prisma.$disconnect();
  console.log("[Worker] shutdown complete");
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

// ---------------------------------------------------------------------------
// 4. Install scheduled (cron-style) jobs. Idempotent — safe to run on every
//    boot. Failure here is non-fatal; the worker still consumes ad-hoc jobs.
// ---------------------------------------------------------------------------
installSchedules().catch((err) => {
  console.error("[Worker] failed to install schedules:", err);
});

console.log(`[Worker] booted with ${workers.length} workers`);
