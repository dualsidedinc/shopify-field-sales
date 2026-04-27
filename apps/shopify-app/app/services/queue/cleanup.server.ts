import { prisma } from "@field-sales/database";

export interface CleanupResult {
  completedDeleted: number;
  failedDeleted: number;
}

/**
 * TTL pruning of QueueJob rows. Keeps the table from growing without bound.
 *
 *  - COMPLETED rows older than 30 days → deleted (success records).
 *  - FAILED rows older than 90 days → deleted (forensic window).
 *
 * QUEUED + PROCESSING rows are never pruned — those are live work.
 *
 * BullMQ jobs themselves are auto-pruned by the queue's `removeOnComplete`
 * / `removeOnFail` config (set in queue.server.ts).
 */
export async function pruneCompletedQueueJobs(
  now: Date = new Date()
): Promise<CleanupResult> {
  const COMPLETED_TTL_DAYS = 30;
  const FAILED_TTL_DAYS = 90;

  const completedCutoff = new Date(now.getTime() - COMPLETED_TTL_DAYS * 24 * 60 * 60 * 1000);
  const failedCutoff = new Date(now.getTime() - FAILED_TTL_DAYS * 24 * 60 * 60 * 1000);

  const [completed, failed] = await Promise.all([
    prisma.queueJob.deleteMany({
      where: { status: "COMPLETED", processedAt: { lt: completedCutoff } },
    }),
    prisma.queueJob.deleteMany({
      where: { status: "FAILED", receivedAt: { lt: failedCutoff } },
    }),
  ]);

  return {
    completedDeleted: completed.count,
    failedDeleted: failed.count,
  };
}
