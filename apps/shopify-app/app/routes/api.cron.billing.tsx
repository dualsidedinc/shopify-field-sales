import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { unauthenticated } from "../shopify.server";
import {
  getShopsForDailyUsageReporting,
  reportMonthlyUsageForShop,
  syncUsageLineItemId,
  type MonthlyUsageResult,
} from "../services/billing.server";
import { prisma } from "@field-sales/database";

// Secret key to protect internal endpoints
const APP_SECRET = process.env.APP_SECRET;

/**
 * Monthly usage billing cron endpoint
 *
 * Run on the 1st of each month via GitHub Actions to report the previous
 * month's usage to Shopify:
 * - Revenue share: net of (BillingEvent PAID) - (BillingEvent REFUNDED) in
 *   the calendar month, × plan's revenue share %
 * - Extra reps: prorated for the days the shop was active in the period
 *
 * The cron also runs a reconciliation pass per shop, backfilling any
 * BillingEvents that webhook delivery may have missed.
 *
 * Trigger with: POST /api/cron/billing
 * Headers: x-app-secret: <APP_SECRET>
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  // Verify app secret
  const secret = request.headers.get("x-app-secret");
  if (APP_SECRET && secret !== APP_SECRET) {
    console.log("[MonthlyBilling] Unauthorized request");
    return new Response("Unauthorized", { status: 401 });
  }

  const now = new Date();
  console.log(`[MonthlyBilling] Starting at ${now.toISOString()}`);

  const shops = await getShopsForDailyUsageReporting();
  console.log(`[MonthlyBilling] Found ${shops.length} shops to process`);

  const results: MonthlyUsageResult[] = [];
  const errors: Array<{ shop: string; error: string }> = [];

  for (const shop of shops) {
    try {
      console.log(`[MonthlyBilling] Processing ${shop.shopifyDomain}`);

      const { admin } = await unauthenticated.admin(shop.shopifyDomain);

      // Sync usage line item ID if missing.
      const shopData = await prisma.shop.findUnique({
        where: { id: shop.id },
        select: { usageLineItemId: true },
      });
      if (!shopData?.usageLineItemId) {
        console.log(`[MonthlyBilling] Syncing usage line item ID for ${shop.shopifyDomain}`);
        const syncResult = await syncUsageLineItemId(admin, shop.id);
        if (!syncResult.success) {
          errors.push({
            shop: shop.shopifyDomain,
            error: `Failed to sync line item ID: ${syncResult.error}`,
          });
          continue;
        }
      }

      const result = await reportMonthlyUsageForShop(shop.id, admin, now);
      if (result) {
        results.push(result);
      }
    } catch (error) {
      console.error(`[MonthlyBilling] Error processing ${shop.shopifyDomain}:`, error);
      errors.push({
        shop: shop.shopifyDomain,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  const successCount = results.filter(
    (r) => r.revenueShare.reported && r.extraReps.reported
  ).length;

  const totalRevenueShare = results.reduce(
    (sum, r) => sum + r.revenueShare.revenueShareCents,
    0
  );
  const totalRepCharges = results.reduce(
    (sum, r) => sum + r.extraReps.proratedChargeCents,
    0
  );
  const totalReconciled = results.reduce(
    (sum, r) => sum + r.reconciliation.paidEventsAdded + r.reconciliation.refundedEventsAdded,
    0
  );

  console.log(`[MonthlyBilling] Completed: ${successCount}/${shops.length} successful`);
  console.log(`[MonthlyBilling] Total charges: $${((totalRevenueShare + totalRepCharges) / 100).toFixed(2)}`);
  console.log(`[MonthlyBilling] Reconciliation backfilled ${totalReconciled} events across all shops`);

  return Response.json({
    success: true,
    timestamp: now.toISOString(),
    summary: {
      shopsProcessed: shops.length,
      successful: successCount,
      errors: errors.length,
      totalRevenueShareCents: totalRevenueShare,
      totalRepChargesCents: totalRepCharges,
      totalChargesCents: totalRevenueShare + totalRepCharges,
      eventsBackfilled: totalReconciled,
    },
    results,
    errors,
  });
};

// GET endpoint for status check
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const secret = url.searchParams.get("secret");

  if (APP_SECRET && secret !== APP_SECRET) {
    return new Response("Unauthorized", { status: 401 });
  }

  const shops = await getShopsForDailyUsageReporting();

  // Count of unreported BillingEvents (the new ledger).
  const unreportedEvents = await prisma.billingEvent.count({
    where: { reportedAt: null },
  });

  return Response.json({
    message: "Monthly billing cron endpoint. POST on the 1st of each month to report previous month's usage.",
    currentDate: new Date().toISOString(),
    activeShops: shops.length,
    unreportedEvents,
  });
};
