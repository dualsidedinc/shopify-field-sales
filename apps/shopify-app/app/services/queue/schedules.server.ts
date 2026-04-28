import { getQueue } from "./queue.server";

/**
 * Source of truth for every scheduled (cron-style) job. BullMQ's Job
 * Schedulers (v5+) hold the schedule state in Redis; `installSchedules()`
 * upserts each one on worker boot so this file IS the spec — change a
 * pattern here, deploy, done. Removing an entry here does NOT remove the
 * scheduler from Redis; call `removeJobScheduler(key)` manually if needed.
 *
 * Each entry maps to an ACTION-kind handler in handlers/actions.server.ts.
 */

interface ScheduleSpec {
  /** Stable key in Redis. Don't rename — that creates a duplicate scheduler. */
  key: string;
  /** ACTION-kind topic. A handler must be registered for it. */
  topic: string;
  /** Cron pattern, evaluated in UTC. */
  pattern: string;
}

const SCHEDULES: ScheduleSpec[] = [
  // Daily at 06:00 UTC — sweep PENDING orders past their payment due date.
  { key: "daily-payments", topic: "scheduled.daily-payments", pattern: "0 6 * * *" },

  // Daily at 02:00 UTC — pull companies/products/catalogs from Shopify.
  { key: "nightly-sync", topic: "scheduled.nightly-sync", pattern: "0 2 * * *" },

  // Daily at 03:00 UTC — prune COMPLETED/FAILED QueueJob rows.
  { key: "queue-cleanup", topic: "scheduled.queue-cleanup", pattern: "0 3 * * *" },

  // 1st of every month at 00:05 UTC — report previous month's usage.
  { key: "monthly-billing", topic: "scheduled.monthly-billing", pattern: "5 0 1 * *" },
];

export async function installSchedules(): Promise<void> {
  const queue = getQueue("ACTION");

  for (const spec of SCHEDULES) {
    await queue.upsertJobScheduler(
      spec.key,
      { pattern: spec.pattern, tz: "UTC" },
      { name: spec.topic, data: { topic: spec.topic } }
    );
  }

  console.log(
    `[Schedules] installed ${SCHEDULES.length} schedulers: ${SCHEDULES.map((s) => s.key).join(", ")}`
  );
}
