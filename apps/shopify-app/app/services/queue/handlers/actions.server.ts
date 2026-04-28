import { prisma } from "@field-sales/database";
import { unauthenticated } from "../../../shopify.server";
import { processDuePayments } from "../../payments.server";
import {
  getShopsForDailyUsageReporting,
  reportMonthlyUsageForShop,
  syncUsageLineItemId,
} from "../../billing.server";
import { syncAllShops } from "../../sync.server";
import { pruneCompletedQueueJobs } from "../cleanup.server";
import { registerHandler, type JobHandler } from "../registry.server";

/**
 * Handlers for QueueJobKind.ACTION — scheduled work fired by BullMQ Job
 * Schedulers (see schedules.server.ts).
 */

const handleDailyPayments: JobHandler = async () => {
  const result = await processDuePayments();
  console.log(
    `[ScheduledAction:daily-payments] processed=${result.processed} ` +
      `charged=${result.charged} invoiced=${result.invoiced}`
  );
};

const handleMonthlyBilling: JobHandler = async () => {
  const now = new Date();
  const shops = await getShopsForDailyUsageReporting();
  console.log(`[ScheduledAction:monthly-billing] processing ${shops.length} shops`);

  for (const shop of shops) {
    try {
      const { admin } = await unauthenticated.admin(shop.shopifyDomain);

      const shopData = await prisma.shop.findUnique({
        where: { id: shop.id },
        select: { usageLineItemId: true },
      });
      if (!shopData?.usageLineItemId) {
        const syncResult = await syncUsageLineItemId(admin, shop.id);
        if (!syncResult.success) {
          console.error(
            `[ScheduledAction:monthly-billing] line-item sync failed for ${shop.shopifyDomain}: ${syncResult.error}`
          );
          continue;
        }
      }

      await reportMonthlyUsageForShop(shop.id, admin, now);
    } catch (error) {
      console.error(
        `[ScheduledAction:monthly-billing] error for ${shop.shopifyDomain}:`,
        error
      );
    }
  }
};

const handleNightlySync: JobHandler = async () => {
  const result = await syncAllShops({ objects: ["all"], force: false });
  console.log(
    `[ScheduledAction:nightly-sync] duration=${result.duration}ms success=${result.success}`
  );
};

const handleQueueCleanup: JobHandler = async () => {
  const result = await pruneCompletedQueueJobs(new Date());
  console.log(
    `[ScheduledAction:queue-cleanup] completed=${result.completedDeleted} failed=${result.failedDeleted}`
  );
};

export function registerActionHandlers(): void {
  registerHandler("ACTION", "scheduled.daily-payments", handleDailyPayments);
  registerHandler("ACTION", "scheduled.monthly-billing", handleMonthlyBilling);
  registerHandler("ACTION", "scheduled.nightly-sync", handleNightlySync);
  registerHandler("ACTION", "scheduled.queue-cleanup", handleQueueCleanup);
}
