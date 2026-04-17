import { prisma } from "@field-sales/database";
import type { BillingPlan, BillingStatus } from "@prisma/client";

// ============================================
// Environment Configuration
// ============================================

/**
 * Check if Shopify Billing should be bypassed for this instance.
 * Used for custom app distributions where billing is handled outside Shopify.
 * Set BYPASS_SHOPIFY_BILLING=true in environment to enable.
 */
export function shouldBypassShopifyBilling(): boolean {
  return process.env.BYPASS_SHOPIFY_BILLING === "true";
}

// ============================================
// Plan Configuration
// ============================================

export interface PlanConfig {
  name: string;
  includedReps: number;
  perRepCents: number;       // Per rep price in cents
  basePriceCents: number;    // includedReps * perRepCents
  revenueSharePercent: number; // e.g., 0.50 for 0.50%
}

export const PLAN_CONFIGS: Record<BillingPlan, PlanConfig> = {
  BASIC: {
    name: "Basic",
    includedReps: 10,
    perRepCents: 1000,      // $10
    basePriceCents: 10000,  // $100
    revenueSharePercent: 0.50,
  },
  GROW: {
    name: "Grow",
    includedReps: 25,
    perRepCents: 900,       // $9
    basePriceCents: 20000,  // $200
    revenueSharePercent: 0.50,
  },
  PRO: {
    name: "Pro",
    includedReps: 50,
    perRepCents: 800,       // $8
    basePriceCents: 30000,  // $300
    revenueSharePercent: 0.45,
  },
  PLUS: {
    name: "Plus",
    includedReps: 75,
    perRepCents: 700,       // $7
    basePriceCents: 50000,  // $500
    revenueSharePercent: 0.40,
  },
};

export const TRIAL_DAYS = 7;

// ============================================
// Types
// ============================================

export interface BillingStatusInfo {
  status: BillingStatus;
  plan: BillingPlan | null;
  trialEndsAt: Date | null;
  trialDaysRemaining: number | null;
  isActive: boolean;
  isTrial: boolean;
  requiresBilling: boolean;
}

export interface SubscriptionResult {
  success: boolean;
  confirmationUrl?: string;
  subscriptionId?: string;
  error?: string;
}

export interface UsageReportResult {
  success: boolean;
  usageRecordId?: string;
  error?: string;
}

export interface UsageCharges {
  activeRepCount: number;
  includedReps: number;
  extraRepCount: number;
  repChargesCents: number;
  orderCount: number;
  orderRevenueCents: number;
  revenueShareCents: number;
  totalChargesCents: number;
}

// ============================================
// GraphQL Mutations
// ============================================

const APP_SUBSCRIPTION_CREATE = `#graphql
  mutation AppSubscriptionCreate(
    $name: String!
    $returnUrl: URL!
    $test: Boolean
    $trialDays: Int
    $lineItems: [AppSubscriptionLineItemInput!]!
    $replacementBehavior: AppSubscriptionReplacementBehavior
  ) {
    appSubscriptionCreate(
      name: $name
      returnUrl: $returnUrl
      test: $test
      trialDays: $trialDays
      lineItems: $lineItems
      replacementBehavior: $replacementBehavior
    ) {
      appSubscription {
        id
        status
        currentPeriodEnd
        lineItems {
          id
          plan {
            pricingDetails {
              ... on AppUsagePricing {
                terms
                cappedAmount {
                  amount
                  currencyCode
                }
              }
              ... on AppRecurringPricing {
                price {
                  amount
                  currencyCode
                }
              }
            }
          }
        }
      }
      confirmationUrl
      userErrors {
        field
        message
      }
    }
  }
`;

const APP_USAGE_RECORD_CREATE = `#graphql
  mutation AppUsageRecordCreate(
    $subscriptionLineItemId: ID!
    $price: MoneyInput!
    $description: String!
    $idempotencyKey: String!
  ) {
    appUsageRecordCreate(
      subscriptionLineItemId: $subscriptionLineItemId
      price: $price
      description: $description
      idempotencyKey: $idempotencyKey
    ) {
      appUsageRecord {
        id
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const CURRENT_APP_INSTALLATION = `#graphql
  query CurrentAppInstallation {
    currentAppInstallation {
      activeSubscriptions {
        id
        name
        status
        currentPeriodEnd
        lineItems {
          id
          plan {
            pricingDetails {
              ... on AppUsagePricing {
                terms
                cappedAmount {
                  amount
                  currencyCode
                }
              }
            }
          }
        }
      }
    }
  }
`;

const APP_SUBSCRIPTION_CANCEL = `#graphql
  mutation AppSubscriptionCancel($id: ID!) {
    appSubscriptionCancel(id: $id) {
      appSubscription {
        id
        status
      }
      userErrors {
        field
        message
      }
    }
  }
`;

// ============================================
// Core Functions
// ============================================

/**
 * Get plan configuration for a billing plan
 */
export function getPlanConfig(plan: BillingPlan): PlanConfig {
  return PLAN_CONFIGS[plan];
}

/**
 * Get billing status information for a shop
 */
export async function getBillingStatus(shopId: string): Promise<BillingStatusInfo> {
  const shop = await prisma.shop.findUnique({
    where: { id: shopId },
    select: {
      billingStatus: true,
      billingPlan: true,
      trialEndsAt: true,
    },
  });

  if (!shop) {
    return {
      status: "INACTIVE",
      plan: null,
      trialEndsAt: null,
      trialDaysRemaining: null,
      isActive: false,
      isTrial: false,
      requiresBilling: true,
    };
  }

  // Instance-level bypass: always considered active, no Shopify billing required
  if (shouldBypassShopifyBilling()) {
    return {
      status: shop.billingStatus === "INACTIVE" ? "ACTIVE" : shop.billingStatus,
      plan: shop.billingPlan,
      trialEndsAt: null,
      trialDaysRemaining: null,
      isActive: true,
      isTrial: false,
      requiresBilling: false,
    };
  }

  const now = new Date();
  const trialEndsAt = shop.trialEndsAt;
  const trialDaysRemaining = trialEndsAt
    ? Math.max(0, Math.ceil((trialEndsAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)))
    : null;

  const isTrial = shop.billingStatus === "TRIAL";
  const trialExpired = isTrial && trialEndsAt && now > trialEndsAt;
  const isActive = shop.billingStatus === "ACTIVE" || (isTrial && !trialExpired);
  const requiresBilling = !isActive || (trialDaysRemaining !== null && trialDaysRemaining <= 0);

  return {
    status: shop.billingStatus,
    plan: shop.billingPlan,
    trialEndsAt,
    trialDaysRemaining,
    isActive,
    isTrial,
    requiresBilling,
  };
}

/**
 * Check if shop has active billing (or is in trial)
 */
export async function hasActiveBilling(shopId: string): Promise<boolean> {
  const status = await getBillingStatus(shopId);
  return status.isActive;
}

/**
 * Sync usage line item ID from Shopify (for existing subscriptions)
 */
export async function syncUsageLineItemId(
  admin: { graphql: (query: string, options?: { variables: Record<string, unknown> }) => Promise<Response> },
  shopId: string
): Promise<{ success: boolean; usageLineItemId?: string; error?: string }> {
  try {
    const response = await admin.graphql(CURRENT_APP_INSTALLATION);
    const result = await response.json();

    const subscriptions = result.data?.currentAppInstallation?.activeSubscriptions || [];
    if (subscriptions.length === 0) {
      return { success: false, error: "No active subscription found" };
    }

    // Find the usage line item (the one with terms/cappedAmount)
    const subscription = subscriptions[0];
    const usageLineItem = subscription.lineItems?.find(
      (item: { plan?: { pricingDetails?: { terms?: string } } }) =>
        item.plan?.pricingDetails?.terms !== undefined
    );

    if (!usageLineItem?.id) {
      return { success: false, error: "No usage line item found" };
    }

    await prisma.shop.update({
      where: { id: shopId },
      data: { usageLineItemId: usageLineItem.id },
    });

    return { success: true, usageLineItemId: usageLineItem.id };
  } catch (error) {
    console.error("[syncUsageLineItemId] Error:", error);
    return { success: false, error: "Failed to sync usage line item ID" };
  }
}

/**
 * Cancel any existing subscriptions for an app
 */
export async function cancelExistingSubscriptions(
  admin: { graphql: (query: string, options?: { variables: Record<string, unknown> }) => Promise<Response> }
): Promise<void> {
  try {
    console.log("[cancelExistingSubscriptions] Fetching current app installation...");
    const response = await admin.graphql(CURRENT_APP_INSTALLATION);
    const result = await response.json();
    console.log("[cancelExistingSubscriptions] Current app installation result:", JSON.stringify(result, null, 2));

    const subscriptions = result.data?.currentAppInstallation?.activeSubscriptions || [];
    console.log("[cancelExistingSubscriptions] Found subscriptions:", subscriptions.length);

    for (const sub of subscriptions) {
      console.log("[cancelExistingSubscriptions] Processing subscription:", sub);
      if (sub.id && sub.status !== "CANCELLED") {
        console.log(`[cancelExistingSubscriptions] Cancelling subscription: ${sub.id} (status: ${sub.status})`);
        const cancelResponse = await admin.graphql(APP_SUBSCRIPTION_CANCEL, {
          variables: { id: sub.id },
        });
        const cancelResult = await cancelResponse.json();
        console.log("[cancelExistingSubscriptions] Cancel result:", JSON.stringify(cancelResult, null, 2));
      } else {
        console.log(`[cancelExistingSubscriptions] Skipping subscription ${sub.id} - status: ${sub.status}`);
      }
    }
    console.log("[cancelExistingSubscriptions] Done cancelling subscriptions");
  } catch (error) {
    console.error("[cancelExistingSubscriptions] Error:", error);
    // Continue anyway - the new subscription attempt will tell us if there's still a conflict
  }
}

/**
 * Create a billing subscription for a shop
 */
export async function createBillingSubscription(
  shopId: string,
  plan: BillingPlan,
  admin: { graphql: (query: string, options?: { variables: Record<string, unknown> }) => Promise<Response> },
  returnUrl: string,
  isTest: boolean = false
): Promise<SubscriptionResult> {
  console.log("[createBillingSubscription] Starting for shopId:", shopId, "plan:", plan);
  console.log("[createBillingSubscription] Return URL:", returnUrl, "isTest:", isTest);

  // Note: We use replacementBehavior: "APPLY_IMMEDIATELY" which handles replacing
  // the existing subscription atomically when the new one is approved.
  // This ensures the current plan is maintained if the user cancels/declines.

  const planConfig = getPlanConfig(plan);

  // Calculate capped amount for usage charges (extra reps + revenue share)
  // Extra reps: up to 200 extra reps at per-rep rate
  // Revenue share: up to $10,000 in revenue share per period
  const repCappedAmount = planConfig.perRepCents * 200 / 100; // $2,000 for BASIC
  const revenueCappedAmount = 10000; // $10,000 max revenue share
  const totalCappedAmount = repCappedAmount + revenueCappedAmount;

  const subscriptionName = `Field Sales Manager - ${planConfig.name}`;
  const usageTerms = `Usage charges: $${(planConfig.perRepCents / 100).toFixed(2)}/rep beyond ${planConfig.includedReps} included, plus ${planConfig.revenueSharePercent}% of order revenue`;

  console.log("[createBillingSubscription] Creating subscription with name:", subscriptionName);
  console.log("[createBillingSubscription] Base price:", (planConfig.basePriceCents / 100).toFixed(2));
  console.log("[createBillingSubscription] Total capped amount:", totalCappedAmount.toFixed(2));
  console.log("[createBillingSubscription] Using replacementBehavior: APPLY_IMMEDIATELY");

  try {
    // Shopify only allows ONE usage-based line item per subscription
    // We report both rep charges and revenue share as separate usage records to this single line item
    const response = await admin.graphql(APP_SUBSCRIPTION_CREATE, {
      variables: {
        name: subscriptionName,
        returnUrl,
        test: isTest,
        trialDays: TRIAL_DAYS,
        replacementBehavior: "APPLY_IMMEDIATELY",
        lineItems: [
          {
            plan: {
              appRecurringPricingDetails: {
                price: {
                  amount: (planConfig.basePriceCents / 100).toFixed(2),
                  currencyCode: "USD",
                },
                interval: "EVERY_30_DAYS",
              },
            },
          },
          {
            plan: {
              appUsagePricingDetails: {
                terms: usageTerms,
                cappedAmount: {
                  amount: totalCappedAmount.toFixed(2),
                  currencyCode: "USD",
                },
              },
            },
          },
        ],
      },
    });

    const result = await response.json();
    console.log("[createBillingSubscription] Full GraphQL response:", JSON.stringify(result, null, 2));

    if (result.data?.appSubscriptionCreate?.userErrors?.length > 0) {
      const errors = result.data.appSubscriptionCreate.userErrors;
      console.log("[createBillingSubscription] User errors:", errors);
      return {
        success: false,
        error: errors.map((e: { message: string }) => e.message).join(", "),
      };
    }

    const subscription = result.data?.appSubscriptionCreate?.appSubscription;
    const confirmationUrl = result.data?.appSubscriptionCreate?.confirmationUrl;
    console.log("[createBillingSubscription] Subscription created:", subscription);
    console.log("[createBillingSubscription] Confirmation URL:", confirmationUrl);

    if (!subscription || !confirmationUrl) {
      console.log("[createBillingSubscription] Missing subscription or confirmationUrl");
      return {
        success: false,
        error: "Failed to create subscription",
      };
    }

    // Extract the usage line item ID (the one with AppUsagePricing)
    const usageLineItem = subscription.lineItems?.find(
      (item: { plan?: { pricingDetails?: { terms?: string } } }) =>
        item.plan?.pricingDetails?.terms !== undefined
    );
    const usageLineItemId = usageLineItem?.id || null;
    console.log("[createBillingSubscription] Usage line item ID:", usageLineItemId);

    // Update shop with pending subscription (don't set billingPlan until approval)
    const updatedShop = await prisma.shop.update({
      where: { id: shopId },
      data: {
        shopifySubscriptionId: subscription.id,
        usageLineItemId,
        subscriptionStatus: subscription.status,
      },
    });
    console.log("[createBillingSubscription] Updated shop:", { id: updatedShop.id, shopifySubscriptionId: updatedShop.shopifySubscriptionId, usageLineItemId: updatedShop.usageLineItemId });

    return {
      success: true,
      confirmationUrl,
      subscriptionId: subscription.id,
    };
  } catch (error) {
    console.error("Error creating subscription:", error);
    return {
      success: false,
      error: "Failed to create subscription",
    };
  }
}

/**
 * Activate billing after merchant approves subscription
 *
 * Shopify handles proration automatically when plans change.
 * We only track billing periods for usage calculation (extra reps, revenue share).
 */
export async function activateBilling(
  shopId: string,
  subscriptionId: string,
  plan: BillingPlan
): Promise<{ success: boolean; error?: string }> {
  console.log("[activateBilling] Starting with shopId:", shopId, "subscriptionId:", subscriptionId, "plan:", plan);

  const shop = await prisma.shop.findUnique({
    where: { id: shopId },
  });
  console.log("[activateBilling] Found shop:", shop ? { id: shop.id, billingPlan: shop.billingPlan, billingStatus: shop.billingStatus } : null);

  if (!shop) {
    console.log("[activateBilling] Shop not found");
    return { success: false, error: "Shop not found" };
  }

  // Check if this is a new subscription or a plan change
  const isNewSubscription = shop.billingStatus === "INACTIVE" || shop.billingStatus === "CANCELLED";
  console.log("[activateBilling] isNewSubscription:", isNewSubscription);

  const now = new Date();

  // Only set trial for new subscriptions
  let trialEndsAt: Date | undefined;
  let billingStatus: BillingStatus;
  let periodStart: Date;
  let periodEnd: Date;

  if (isNewSubscription) {
    trialEndsAt = new Date(now);
    trialEndsAt.setDate(trialEndsAt.getDate() + TRIAL_DAYS);
    billingStatus = "TRIAL";
    periodStart = now;
    periodEnd = new Date(now);
    periodEnd.setDate(periodEnd.getDate() + 30);
  } else {
    // For plan changes, keep existing status and period dates
    // Shopify handles proration - we just update the plan
    billingStatus = shop.billingStatus === "TRIAL" ? "TRIAL" : "ACTIVE";
    periodStart = shop.currentPeriodStart || now;
    periodEnd = shop.currentPeriodEnd || new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  }

  console.log("[activateBilling] Will set billingStatus:", billingStatus, "trialEndsAt:", trialEndsAt);

  const planConfig = getPlanConfig(plan);

  try {
    await prisma.$transaction(async (tx) => {
      console.log("[activateBilling] Starting transaction");

      // Update shop billing status and plan
      const updatedShop = await tx.shop.update({
        where: { id: shopId },
        data: {
          billingPlan: plan,
          billingStatus,
          subscriptionStatus: "ACTIVE",
          shopifySubscriptionId: subscriptionId,
          ...(trialEndsAt && { trialEndsAt }),
          ...(isNewSubscription && {
            currentPeriodStart: periodStart,
            currentPeriodEnd: periodEnd,
          }),
        },
      });
      console.log("[activateBilling] Updated shop:", { billingStatus: updatedShop.billingStatus, billingPlan: updatedShop.billingPlan });

      if (isNewSubscription) {
        // New subscription: create initial billing period
        const billingPeriod = await tx.billingPeriod.create({
          data: {
            shopId,
            periodStart,
            periodEnd,
            plan,
            includedReps: planConfig.includedReps,
            perRepCents: planConfig.perRepCents,
            revenueSharePercent: planConfig.revenueSharePercent,
          },
        });
        console.log("[activateBilling] Created billing period:", billingPeriod.id);

        // Backfill activatedAt for existing active reps
        const updatedReps = await tx.salesRep.updateMany({
          where: {
            shopId,
            isActive: true,
            activatedAt: null,
          },
          data: {
            activatedAt: now,
          },
        });
        console.log("[activateBilling] Updated reps count:", updatedReps.count);
      } else {
        // Plan change: update current billing period with new plan config
        // This affects how usage charges are calculated going forward
        await tx.billingPeriod.updateMany({
          where: {
            shopId,
            status: "open",
          },
          data: {
            plan,
            includedReps: planConfig.includedReps,
            perRepCents: planConfig.perRepCents,
            revenueSharePercent: planConfig.revenueSharePercent,
          },
        });
        console.log("[activateBilling] Updated billing period to new plan:", plan);
      }
    });

    console.log("[activateBilling] Transaction completed successfully");
    return { success: true };
  } catch (error) {
    console.error("[activateBilling] Error activating billing:", error);
    return { success: false, error: "Failed to activate billing" };
  }
}

/**
 * Get or create current billing period for a shop
 */
export async function getCurrentBillingPeriod(shopId: string) {
  const shop = await prisma.shop.findUnique({
    where: { id: shopId },
    select: {
      billingPlan: true,
      currentPeriodStart: true,
      currentPeriodEnd: true,
    },
  });

  if (!shop || !shop.currentPeriodStart || !shop.currentPeriodEnd) {
    return null;
  }

  // Find existing period
  let period = await prisma.billingPeriod.findUnique({
    where: {
      shopId_periodStart: {
        shopId,
        periodStart: shop.currentPeriodStart,
      },
    },
  });

  // Create if doesn't exist
  if (!period && shop.billingPlan) {
    const planConfig = getPlanConfig(shop.billingPlan);
    period = await prisma.billingPeriod.create({
      data: {
        shopId,
        periodStart: shop.currentPeriodStart,
        periodEnd: shop.currentPeriodEnd,
        plan: shop.billingPlan,
        includedReps: planConfig.includedReps,
        perRepCents: planConfig.perRepCents,
        revenueSharePercent: planConfig.revenueSharePercent,
      },
    });
  }

  return period;
}

/**
 * Calculate usage charges for a shop
 */
export async function calculateUsageCharges(shopId: string): Promise<UsageCharges> {
  const period = await getCurrentBillingPeriod(shopId);

  if (!period) {
    return {
      activeRepCount: 0,
      includedReps: 0,
      extraRepCount: 0,
      repChargesCents: 0,
      orderCount: 0,
      orderRevenueCents: 0,
      revenueShareCents: 0,
      totalChargesCents: 0,
    };
  }

  // Count active reps
  const activeRepCount = await prisma.salesRep.count({
    where: { shopId, isActive: true },
  });

  // Calculate extra rep charges
  const extraRepCount = Math.max(0, activeRepCount - period.includedReps);
  const repChargesCents = extraRepCount * period.perRepCents;

  // Get unbilled paid orders for revenue share
  const unbilledOrders = await prisma.order.findMany({
    where: {
      shopId,
      status: "PAID",
      paidAt: {
        gte: period.periodStart,
        lte: period.periodEnd,
      },
      billedOrder: null,
    },
    select: { id: true, totalCents: true },
  });

  const orderRevenueCents = unbilledOrders.reduce((sum, o) => sum + o.totalCents, 0);
  const revenueShareCents = Math.round(orderRevenueCents * (period.revenueSharePercent / 100));

  return {
    activeRepCount,
    includedReps: period.includedReps,
    extraRepCount,
    repChargesCents,
    orderCount: unbilledOrders.length,
    orderRevenueCents,
    revenueShareCents,
    totalChargesCents: repChargesCents + revenueShareCents,
  };
}

/**
 * Record an order as billed for revenue share
 */
export async function recordBilledOrder(
  orderId: string,
  billingPeriodId: string,
  revenueSharePercent: number
): Promise<void> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { totalCents: true },
  });

  if (!order) return;

  const revenueShareCents = Math.round(order.totalCents * (revenueSharePercent / 100));

  await prisma.$transaction(async (tx) => {
    // Create billed order record
    await tx.billedOrder.create({
      data: {
        billingPeriodId,
        orderId,
        totalCents: order.totalCents,
        revenueShareCents,
      },
    });

    // Update billing period totals
    await tx.billingPeriod.update({
      where: { id: billingPeriodId },
      data: {
        orderRevenueCents: { increment: order.totalCents },
        revenueShareCents: { increment: revenueShareCents },
      },
    });
  });
}

/**
 * Report a usage charge to Shopify
 */
export async function reportUsageCharge(
  admin: { graphql: (query: string, options?: { variables: Record<string, unknown> }) => Promise<Response> },
  usageLineItemId: string,
  amountCents: number,
  description: string,
  idempotencyKey: string
): Promise<UsageReportResult> {
  if (amountCents <= 0) {
    return { success: true }; // Nothing to charge
  }

  try {
    const response = await admin.graphql(APP_USAGE_RECORD_CREATE, {
      variables: {
        subscriptionLineItemId: usageLineItemId,
        price: {
          amount: (amountCents / 100).toFixed(2),
          currencyCode: "USD",
        },
        description,
        idempotencyKey,
      },
    });

    const result = await response.json();
    console.log("[reportUsageCharge] Result:", JSON.stringify(result, null, 2));

    if (result.data?.appUsageRecordCreate?.userErrors?.length > 0) {
      const errors = result.data.appUsageRecordCreate.userErrors;
      return {
        success: false,
        error: errors.map((e: { message: string }) => e.message).join(", "),
      };
    }

    return {
      success: true,
      usageRecordId: result.data?.appUsageRecordCreate?.appUsageRecord?.id,
    };
  } catch (error) {
    console.error("[reportUsageCharge] Error:", error);
    return { success: false, error: "Failed to report usage charge" };
  }
}

/**
 * @deprecated Use reportDailyUsageForShop instead. This function was used for
 * end-of-month batch reporting but has been replaced by daily reporting.
 *
 * Report all usage charges for a billing period (end of month)
 * This calculates and reports:
 * 1. Extra rep charges based on active rep count
 * 2. Revenue share from all paid orders in the period
 */
export async function reportPeriodUsage(
  admin: { graphql: (query: string, options?: { variables: Record<string, unknown> }) => Promise<Response> },
  shopId: string
): Promise<{ success: boolean; repResult?: UsageReportResult; revenueResult?: UsageReportResult; error?: string }> {
  const shop = await prisma.shop.findUnique({
    where: { id: shopId },
    select: {
      usageLineItemId: true,
      billingPlan: true,
      currentPeriodStart: true,
      currentPeriodEnd: true,
    },
  });

  if (!shop?.usageLineItemId || !shop.billingPlan) {
    return { success: false, error: "Shop not configured for billing" };
  }

  if (!shop.currentPeriodStart || !shop.currentPeriodEnd) {
    return { success: false, error: "No active billing period" };
  }

  const planConfig = getPlanConfig(shop.billingPlan);
  const periodKey = shop.currentPeriodStart.toISOString().slice(0, 10);

  // Calculate extra rep charges
  const activeRepCount = await prisma.salesRep.count({
    where: { shopId, isActive: true },
  });
  const extraRepCount = Math.max(0, activeRepCount - planConfig.includedReps);
  const repChargesCents = extraRepCount * planConfig.perRepCents;

  // Calculate revenue share from paid orders in this period
  const paidOrders = await prisma.order.findMany({
    where: {
      shopId,
      status: "PAID",
      paidAt: {
        gte: shop.currentPeriodStart,
        lte: shop.currentPeriodEnd,
      },
    },
    select: { totalCents: true },
  });
  const totalRevenueCents = paidOrders.reduce((sum, o) => sum + o.totalCents, 0);
  const revenueShareCents = Math.round(totalRevenueCents * (planConfig.revenueSharePercent / 100));

  console.log("[reportPeriodUsage] Period:", periodKey);
  console.log("[reportPeriodUsage] Active reps:", activeRepCount, "Extra:", extraRepCount, "Charge:", repChargesCents);
  console.log("[reportPeriodUsage] Orders:", paidOrders.length, "Revenue:", totalRevenueCents, "Share:", revenueShareCents);

  // Report extra rep charges
  let repResult: UsageReportResult = { success: true };
  if (repChargesCents > 0) {
    const repDescription = `Extra sales reps (${extraRepCount} × $${(planConfig.perRepCents / 100).toFixed(2)})`;
    repResult = await reportUsageCharge(
      admin,
      shop.usageLineItemId,
      repChargesCents,
      repDescription,
      `rep-charges-${shopId}-${periodKey}`
    );
  }

  // Report revenue share
  let revenueResult: UsageReportResult = { success: true };
  if (revenueShareCents > 0) {
    const revenueDescription = `Revenue share (${planConfig.revenueSharePercent}% of $${(totalRevenueCents / 100).toFixed(2)})`;
    revenueResult = await reportUsageCharge(
      admin,
      shop.usageLineItemId,
      revenueShareCents,
      revenueDescription,
      `revenue-share-${shopId}-${periodKey}`
    );
  }

  const success = repResult.success && revenueResult.success;
  return { success, repResult, revenueResult };
}

/**
 * Handle subscription webhook updates
 */
export async function handleSubscriptionUpdate(
  shopDomain: string,
  payload: {
    app_subscription?: {
      admin_graphql_api_id?: string;
      status?: string;
      current_period_end?: string;
    };
  }
): Promise<{ success: boolean; error?: string }> {
  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: shopDomain },
  });

  if (!shop) {
    return { success: false, error: "Shop not found" };
  }

  const subscription = payload.app_subscription;
  if (!subscription) {
    return { success: false, error: "No subscription in payload" };
  }

  const status = subscription.status?.toUpperCase();

  let billingStatus: BillingStatus = shop.billingStatus;
  if (status === "ACTIVE") {
    // Check if still in trial
    if (shop.trialEndsAt && new Date() < shop.trialEndsAt) {
      billingStatus = "TRIAL";
    } else {
      billingStatus = "ACTIVE";
    }
  } else if (status === "CANCELLED" || status === "EXPIRED") {
    billingStatus = "CANCELLED";
  } else if (status === "FROZEN") {
    billingStatus = "PAST_DUE";
  }

  await prisma.shop.update({
    where: { id: shop.id },
    data: {
      billingStatus,
      subscriptionStatus: status,
      currentPeriodEnd: subscription.current_period_end
        ? new Date(subscription.current_period_end)
        : undefined,
    },
  });

  return { success: true };
}

/**
 * Cancel billing for a shop (e.g., on app uninstall)
 */
export async function cancelBilling(shopId: string): Promise<void> {
  await prisma.shop.update({
    where: { id: shopId },
    data: {
      billingStatus: "CANCELLED",
      subscriptionStatus: "CANCELLED",
    },
  });
}

/**
 * Get billing dashboard data
 */
export async function getBillingDashboardData(shopId: string) {
  const shop = await prisma.shop.findUnique({
    where: { id: shopId },
    select: {
      billingPlan: true,
      billingStatus: true,
      trialEndsAt: true,
      currentPeriodStart: true,
      currentPeriodEnd: true,
    },
  });

  if (!shop) return null;

  const status = await getBillingStatus(shopId);
  const usage = await calculateUsageCharges(shopId);
  const planConfig = shop.billingPlan ? getPlanConfig(shop.billingPlan) : null;

  // Get billing history
  const history = await prisma.billingPeriod.findMany({
    where: { shopId },
    orderBy: { periodStart: "desc" },
    take: 6,
  });

  return {
    shop,
    status,
    usage,
    planConfig,
    history,
    allPlans: Object.entries(PLAN_CONFIGS).map(([key, config]) => ({
      key: key as BillingPlan,
      ...config,
    })),
  };
}

// ============================================
// Daily Usage Reporting (Batch)
// ============================================

export interface DailyUsageResult {
  shopId: string;
  shopDomain: string;
  revenueShare: {
    paidOrderCount: number;
    refundedOrderCount: number;
    netRevenueCents: number;
    revenueShareCents: number;
    reported: boolean;
    usageRecordId?: string;
    error?: string;
  };
  extraReps: {
    activeCount: number;
    includedCount: number;
    previouslyCharged: number;
    newCharges: number;
    chargeCents: number;
    reported: boolean;
    usageRecordId?: string;
    error?: string;
  };
}

/**
 * Report daily usage for a single shop
 * Calculates: (Orders PAID) - (Orders REFUNDED) for net revenue share
 */
export async function reportDailyUsageForShop(
  shopId: string,
  admin: { graphql: (query: string, options?: { variables: Record<string, unknown> }) => Promise<Response> }
): Promise<DailyUsageResult | null> {
  const bypassBilling = shouldBypassShopifyBilling();

  const shop = await prisma.shop.findUnique({
    where: { id: shopId },
    select: {
      id: true,
      shopifyDomain: true,
      billingPlan: true,
      billingStatus: true,
      usageLineItemId: true,
    },
  });

  if (!shop || !shop.billingPlan) {
    console.log(`[DailyUsage] Shop ${shopId} not configured for billing`);
    return null;
  }

  // For bypassed instances, we don't need usageLineItemId - we just track locally
  if (!bypassBilling && !shop.usageLineItemId) {
    console.log(`[DailyUsage] Shop ${shopId} missing usageLineItemId`);
    return null;
  }

  // Skip if not active or in trial (unless bypassed)
  if (!bypassBilling && shop.billingStatus !== "ACTIVE" && shop.billingStatus !== "TRIAL") {
    console.log(`[DailyUsage] Shop ${shopId} billing status is ${shop.billingStatus}, skipping`);
    return null;
  }

  const planConfig = getPlanConfig(shop.billingPlan);
  const today = new Date().toISOString().slice(0, 10);

  const result: DailyUsageResult = {
    shopId: shop.id,
    shopDomain: shop.shopifyDomain,
    revenueShare: {
      paidOrderCount: 0,
      refundedOrderCount: 0,
      netRevenueCents: 0,
      revenueShareCents: 0,
      reported: false,
    },
    extraReps: {
      activeCount: 0,
      includedCount: planConfig.includedReps,
      previouslyCharged: 0,
      newCharges: 0,
      chargeCents: 0,
      reported: false,
    },
  };

  // ---- Revenue Share Calculation ----
  // Find orders PAID but not yet reported
  const paidOrders = await prisma.order.findMany({
    where: {
      shopId,
      status: "PAID",
      paidAt: { not: null },
      revenueShareReportedAt: null,
    },
    select: { id: true, totalCents: true },
  });

  // Find orders REFUNDED but not yet reported
  const refundedOrders = await prisma.order.findMany({
    where: {
      shopId,
      status: "REFUNDED",
      refundedAt: { not: null },
      revenueShareReportedAt: null,
    },
    select: { id: true, totalCents: true },
  });

  const paidTotal = paidOrders.reduce((sum, o) => sum + o.totalCents, 0);
  const refundedTotal = refundedOrders.reduce((sum, o) => sum + o.totalCents, 0);
  const netRevenueCents = paidTotal - refundedTotal;
  const revenueShareCents = Math.max(0, Math.round(netRevenueCents * (planConfig.revenueSharePercent / 100)));

  result.revenueShare.paidOrderCount = paidOrders.length;
  result.revenueShare.refundedOrderCount = refundedOrders.length;
  result.revenueShare.netRevenueCents = netRevenueCents;
  result.revenueShare.revenueShareCents = revenueShareCents;

  // Report revenue share if there's a positive amount
  if (revenueShareCents > 0) {
    const description = `Revenue share (${planConfig.revenueSharePercent}% of $${(netRevenueCents / 100).toFixed(2)} net revenue)`;
    const idempotencyKey = `revenue-${shopId}-${today}`;

    // Skip Shopify API call if bypassed, but still track locally
    if (bypassBilling) {
      console.log(`[DailyUsage] Shop ${shop.shopifyDomain} bypasses Shopify billing - logging revenue share locally: $${(revenueShareCents / 100).toFixed(2)}`);
      result.revenueShare.reported = true;

      // Mark all orders as reported (locally tracked)
      const allOrderIds = [...paidOrders, ...refundedOrders].map(o => o.id);
      await prisma.order.updateMany({
        where: { id: { in: allOrderIds } },
        data: {
          revenueShareReportedAt: new Date(),
          revenueShareUsageRecordId: `local-${idempotencyKey}`,
        },
      });
    } else {
      const usageResult = await reportUsageCharge(
        admin,
        shop.usageLineItemId!,
        revenueShareCents,
        description,
        idempotencyKey
      );

      result.revenueShare.reported = usageResult.success;
      result.revenueShare.usageRecordId = usageResult.usageRecordId;
      result.revenueShare.error = usageResult.error;

      if (usageResult.success) {
        // Mark all orders as reported
        const allOrderIds = [...paidOrders, ...refundedOrders].map(o => o.id);
        await prisma.order.updateMany({
          where: { id: { in: allOrderIds } },
          data: {
            revenueShareReportedAt: new Date(),
            revenueShareUsageRecordId: usageResult.usageRecordId,
          },
        });
      }
    }
  } else {
    // No revenue share to report, but still mark orders as processed
    const allOrderIds = [...paidOrders, ...refundedOrders].map(o => o.id);
    if (allOrderIds.length > 0) {
      await prisma.order.updateMany({
        where: { id: { in: allOrderIds } },
        data: { revenueShareReportedAt: new Date() },
      });
    }
    result.revenueShare.reported = true; // Nothing to report is success
  }

  // ---- Extra Rep Charges (Prorated) ----
  // Get current billing period
  const billingPeriod = await prisma.billingPeriod.findFirst({
    where: { shopId, status: "open" },
    select: { id: true, extraRepsCharged: true, perRepCents: true, periodEnd: true },
  });

  if (billingPeriod) {
    const activeRepCount = await prisma.salesRep.count({
      where: { shopId, isActive: true },
    });

    const extraRepsNeeded = Math.max(0, activeRepCount - planConfig.includedReps);
    const extraRepsToCharge = Math.max(0, extraRepsNeeded - billingPeriod.extraRepsCharged);

    result.extraReps.activeCount = activeRepCount;
    result.extraReps.previouslyCharged = billingPeriod.extraRepsCharged;
    result.extraReps.newCharges = extraRepsToCharge;

    if (extraRepsToCharge > 0) {
      // Calculate prorated charge based on days remaining in period
      const now = new Date();
      const periodEnd = new Date(billingPeriod.periodEnd);
      const msPerDay = 24 * 60 * 60 * 1000;
      const daysRemaining = Math.max(1, Math.ceil((periodEnd.getTime() - now.getTime()) / msPerDay));
      const prorationFactor = Math.min(1, daysRemaining / 30); // Cap at 1.0

      const fullChargeCents = extraRepsToCharge * billingPeriod.perRepCents;
      const proratedChargeCents = Math.round(fullChargeCents * prorationFactor);
      result.extraReps.chargeCents = proratedChargeCents;

      const perRepProrated = Math.round(billingPeriod.perRepCents * prorationFactor);
      const description = `Extra sales reps (${extraRepsToCharge} × $${(perRepProrated / 100).toFixed(2)} prorated for ${daysRemaining} days)`;
      const idempotencyKey = `reps-${shopId}-${today}-${activeRepCount}`;

      // Skip Shopify API call if bypassed, but still track locally
      if (bypassBilling) {
        console.log(`[DailyUsage] Shop ${shop.shopifyDomain} bypasses Shopify billing - logging extra reps locally: ${extraRepsToCharge} reps, $${(proratedChargeCents / 100).toFixed(2)}`);
        result.extraReps.reported = true;

        // Update billing period with new charged count (locally tracked)
        await prisma.billingPeriod.update({
          where: { id: billingPeriod.id },
          data: {
            extraRepsCharged: billingPeriod.extraRepsCharged + extraRepsToCharge,
            activeRepCount,
            extraRepCount: extraRepsNeeded,
            repChargesCents: { increment: proratedChargeCents },
          },
        });
      } else {
        const usageResult = await reportUsageCharge(
          admin,
          shop.usageLineItemId!,
          proratedChargeCents,
          description,
          idempotencyKey
        );

        result.extraReps.reported = usageResult.success;
        result.extraReps.usageRecordId = usageResult.usageRecordId;
        result.extraReps.error = usageResult.error;

        if (usageResult.success) {
          // Update billing period with new charged count
          await prisma.billingPeriod.update({
            where: { id: billingPeriod.id },
            data: {
              extraRepsCharged: billingPeriod.extraRepsCharged + extraRepsToCharge,
              activeRepCount,
              extraRepCount: extraRepsNeeded,
              repChargesCents: { increment: proratedChargeCents },
            },
          });
        }
      }
    } else {
      result.extraReps.reported = true; // Nothing to report is success
    }
  }

  console.log(`[DailyUsage] Shop ${shop.shopifyDomain}:`, {
    revenueShare: `${result.revenueShare.paidOrderCount} paid - ${result.revenueShare.refundedOrderCount} refunded = $${(result.revenueShare.netRevenueCents / 100).toFixed(2)} net → $${(result.revenueShare.revenueShareCents / 100).toFixed(2)} share`,
    extraReps: `${result.extraReps.activeCount} active, ${result.extraReps.newCharges} new charges`,
  });

  return result;
}

/**
 * Get all shops that need daily usage reporting
 */
export async function getShopsForDailyUsageReporting(): Promise<Array<{ id: string; shopifyDomain: string }>> {
  const bypassBilling = shouldBypassShopifyBilling();

  // For bypassed instances, include all shops with a billing plan
  // For normal instances, only include shops with active Shopify billing
  return prisma.shop.findMany({
    where: {
      billingPlan: { not: null },
      ...(bypassBilling
        ? {} // All shops with a plan
        : {
            billingStatus: { in: ["ACTIVE", "TRIAL"] },
            usageLineItemId: { not: null },
          }),
    },
    select: {
      id: true,
      shopifyDomain: true,
    },
  });
}
