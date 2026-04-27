import { prisma } from "@field-sales/database";
import type { BillingPlan, BillingStatus, BillingEventType } from "@prisma/client";

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
  // Also treat expired trials as new subscriptions (need to reset trial period)
  const now = new Date();
  const trialExpired = shop.billingStatus === "TRIAL" && shop.trialEndsAt && now > shop.trialEndsAt;
  const isNewSubscription = shop.billingStatus === "INACTIVE" || shop.billingStatus === "CANCELLED" || trialExpired;
  console.log("[activateBilling] isNewSubscription:", isNewSubscription, "trialExpired:", trialExpired);

  // Only set trial for new subscriptions
  let trialEndsAt: Date | undefined;
  let billingStatus: BillingStatus;
  let periodStart: Date;
  let periodEnd: Date;

  // Calendar-month billing: period always ends on the last day of the
  // current calendar month. New installs get a partial first period from
  // their install date to month-end; the monthly cron clamps charges to
  // those days only.
  const currentMonth = getCalendarMonthBoundaries(now);

  if (isNewSubscription) {
    trialEndsAt = new Date(now);
    trialEndsAt.setDate(trialEndsAt.getDate() + TRIAL_DAYS);
    billingStatus = "TRIAL";
    periodStart = now; // install date — anchor for first-period proration
    periodEnd = currentMonth.end;
  } else {
    // For plan changes during active trial/subscription, keep existing status and dates
    // IMPORTANT: trialEndsAt is NOT set here - this prevents shops from extending
    // their trial by changing plans. The existing trialEndsAt is preserved.
    // Shopify handles proration - we just update the plan
    billingStatus = shop.billingStatus === "TRIAL" ? "TRIAL" : "ACTIVE";
    periodStart = shop.currentPeriodStart || now;
    periodEnd = shop.currentPeriodEnd || currentMonth.end;
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
  const shop = await prisma.shop.findUnique({
    where: { id: shopId },
    select: { billingPlan: true, currentPeriodStart: true },
  });

  if (!shop?.billingPlan) {
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

  const planConfig = getPlanConfig(shop.billingPlan);

  // Pending charges = events that have happened so far in the *current*
  // calendar month and haven't been reported to Shopify yet.
  const now = new Date();
  const currentMonth = getCalendarMonthBoundaries(now);
  const installAnchor = shop.currentPeriodStart;
  const periodStart =
    installAnchor && installAnchor > currentMonth.start ? installAnchor : currentMonth.start;
  const daysInPeriod = daysBetween(periodStart, currentMonth.end);
  const daysInFullMonth = daysBetween(currentMonth.start, currentMonth.end);

  const events = await prisma.billingEvent.findMany({
    where: {
      shopId,
      occurredAt: { gte: periodStart, lte: currentMonth.end },
      reportedAt: null,
    },
    select: { type: true, amountCents: true },
  });

  const paidTotalCents = events
    .filter((e) => e.type === "PAID")
    .reduce((sum, e) => sum + e.amountCents, 0);
  const refundedTotalCents = events
    .filter((e) => e.type === "REFUNDED")
    .reduce((sum, e) => sum + e.amountCents, 0);
  const orderRevenueCents = Math.max(0, paidTotalCents - refundedTotalCents);
  const revenueShareCents = Math.round(orderRevenueCents * (planConfig.revenueSharePercent / 100));

  const activeRepCount = await prisma.salesRep.count({
    where: { shopId, isActive: true },
  });
  const extraRepCount = Math.max(0, activeRepCount - planConfig.includedReps);
  const prorationFactor = daysInPeriod / daysInFullMonth;
  const repChargesCents = Math.round(extraRepCount * planConfig.perRepCents * prorationFactor);

  return {
    activeRepCount,
    includedReps: planConfig.includedReps,
    extraRepCount,
    repChargesCents,
    orderCount: events.filter((e) => e.type === "PAID").length,
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

// ============================================
// Calendar-month billing model
// ============================================

/**
 * Returns the inclusive [start, end] of the calendar month containing `date`,
 * with end pinned to the last millisecond of the month.
 */
export function getCalendarMonthBoundaries(date: Date): { start: Date; end: Date } {
  const start = new Date(date.getFullYear(), date.getMonth(), 1, 0, 0, 0, 0);
  const end = new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);
  return { start, end };
}

/**
 * Returns the calendar month BEFORE the one containing `date`.
 */
export function getPreviousCalendarMonth(date: Date): { start: Date; end: Date } {
  const start = new Date(date.getFullYear(), date.getMonth() - 1, 1, 0, 0, 0, 0);
  const end = new Date(date.getFullYear(), date.getMonth(), 0, 23, 59, 59, 999);
  return { start, end };
}

/**
 * Number of full calendar days in a date range (rounded up).
 */
export function daysBetween(start: Date, end: Date): number {
  const ms = end.getTime() - start.getTime();
  return Math.max(1, Math.ceil(ms / (24 * 60 * 60 * 1000)));
}

// ============================================
// Billing event ledger
// ============================================

interface RecordBillingEventInput {
  shopId: string;
  orderId: string | null;
  type: BillingEventType;
  amountCents: number;
  occurredAt: Date;
  source: string; // webhook topic or "manual" / "reconciliation"
}

/**
 * Idempotent insert of a single billing event. Safe to call from webhook
 * handlers — duplicate (shopId, orderId, type, occurredAt) is ignored.
 *
 * When a NEW event is created and `orderId` is set, the corresponding
 * Order.paidAmountCents / refundedAmountCents column is atomically
 * incremented so the Order record carries a denormalized running total.
 * Idempotent skips do not increment.
 */
export async function recordBillingEvent(input: RecordBillingEventInput) {
  if (input.amountCents < 0) {
    throw new Error("BillingEvent.amountCents must be non-negative; type drives sign");
  }

  // Look up by natural key first. orderId can be null for manual adjustments;
  // Prisma's unique index treats nulls as distinct, so adjustments always
  // create new rows.
  const existing = await prisma.billingEvent.findFirst({
    where: {
      shopId: input.shopId,
      orderId: input.orderId,
      type: input.type,
      occurredAt: input.occurredAt,
    },
  });

  if (existing) return existing;

  // Create the event + bump the Order's denormalized total in one transaction.
  // ADJUSTMENT events with no orderId don't touch any Order.
  const orderUpdate =
    input.orderId && (input.type === "PAID" || input.type === "REFUNDED")
      ? prisma.order.update({
          where: { id: input.orderId },
          data:
            input.type === "PAID"
              ? { paidAmountCents: { increment: input.amountCents } }
              : { refundedAmountCents: { increment: input.amountCents } },
        })
      : null;

  const createEvent = prisma.billingEvent.create({
    data: {
      shopId: input.shopId,
      orderId: input.orderId,
      type: input.type,
      amountCents: input.amountCents,
      occurredAt: input.occurredAt,
      source: input.source,
    },
  });

  const [event] = orderUpdate
    ? await prisma.$transaction([createEvent, orderUpdate])
    : [await createEvent];

  return event;
}

// ============================================
// Reconciliation
// ============================================

export interface ReconciliationResult {
  paidEventsAdded: number;
  refundedEventsAdded: number;
  totalChecked: number;
}

/**
 * Diff `Order` rows against `BillingEvent` rows for a period and create any
 * missing events. Webhook delivery isn't 100% reliable — this catches gaps
 * before billing closes the period.
 *
 * - For PAID: any Order with `paidAt` in window but no PAID event → create one.
 * - For REFUNDED: any Order with `refundedAt` in window but no REFUNDED event → create one.
 *
 * Safe to run repeatedly; `recordBillingEvent` is idempotent.
 */
export async function reconcileEventsForPeriod(
  shopId: string,
  periodStart: Date,
  periodEnd: Date
): Promise<ReconciliationResult> {
  const [paidOrders, refundedOrders] = await Promise.all([
    prisma.order.findMany({
      where: {
        shopId,
        status: "PAID",
        paidAt: { gte: periodStart, lte: periodEnd },
      },
      select: { id: true, totalCents: true, paidAt: true },
    }),
    prisma.order.findMany({
      where: {
        shopId,
        status: "REFUNDED",
        refundedAt: { gte: periodStart, lte: periodEnd },
      },
      select: { id: true, totalCents: true, refundedAt: true },
    }),
  ]);

  let paidEventsAdded = 0;
  let refundedEventsAdded = 0;

  for (const o of paidOrders) {
    if (!o.paidAt) continue;
    const existing = await prisma.billingEvent.findFirst({
      where: { shopId, orderId: o.id, type: "PAID" },
      select: { id: true },
    });
    if (!existing) {
      await recordBillingEvent({
        shopId,
        orderId: o.id,
        type: "PAID",
        amountCents: o.totalCents,
        occurredAt: o.paidAt,
        source: "reconciliation",
      });
      paidEventsAdded++;
    }
  }

  for (const o of refundedOrders) {
    if (!o.refundedAt) continue;
    const existing = await prisma.billingEvent.findFirst({
      where: { shopId, orderId: o.id, type: "REFUNDED" },
      select: { id: true },
    });
    if (!existing) {
      await recordBillingEvent({
        shopId,
        orderId: o.id,
        type: "REFUNDED",
        amountCents: o.totalCents,
        occurredAt: o.refundedAt,
        source: "reconciliation",
      });
      refundedEventsAdded++;
    }
  }

  return {
    paidEventsAdded,
    refundedEventsAdded,
    totalChecked: paidOrders.length + refundedOrders.length,
  };
}

// ============================================
// Monthly billing report
// ============================================

export interface MonthlyUsageResult {
  shopId: string;
  shopDomain: string;
  period: { start: Date; end: Date; daysInPeriod: number; daysInFullMonth: number };
  reconciliation: ReconciliationResult;
  revenueShare: {
    paidEventCount: number;
    refundedEventCount: number;
    paidTotalCents: number;
    refundedTotalCents: number;
    netRevenueCents: number;
    revenueShareCents: number;
    reported: boolean;
    usageRecordId?: string;
    error?: string;
  };
  extraReps: {
    activeCount: number;
    includedCount: number;
    extraCount: number;
    proratedChargeCents: number;
    reported: boolean;
    usageRecordId?: string;
    error?: string;
  };
  billingPeriodId?: string;
}

/**
 * Run a calendar-month billing close for a shop. Designed to be called on
 * the 1st of each month for the previous month's events.
 *
 * Flow:
 *   1. Determine the period: previous calendar month, clamped to install
 *      date for first-period new installs.
 *   2. Reconcile: add any missing BillingEvent rows from Order paidAt/refundedAt.
 *   3. Aggregate net revenue from BillingEvent rows in the window.
 *   4. Calculate prorated extra-rep charges.
 *   5. Report to Shopify (or skip if BYPASS_SHOPIFY_BILLING).
 *   6. Tag every event with the billingPeriodId + usageRecordId for audit.
 *   7. Close the period; open the next one.
 */
export async function reportMonthlyUsageForShop(
  shopId: string,
  admin: { graphql: (query: string, options?: { variables: Record<string, unknown> }) => Promise<Response> },
  /** Override the "now" used to compute the previous month — for testing. */
  now: Date = new Date()
): Promise<MonthlyUsageResult | null> {
  const bypassBilling = shouldBypassShopifyBilling();

  const shop = await prisma.shop.findUnique({
    where: { id: shopId },
    select: {
      id: true,
      shopifyDomain: true,
      billingPlan: true,
      billingStatus: true,
      usageLineItemId: true,
      currentPeriodStart: true,
    },
  });

  if (!shop || !shop.billingPlan) {
    console.log(`[MonthlyBilling] Shop ${shopId} not configured for billing`);
    return null;
  }

  if (!bypassBilling && !shop.usageLineItemId) {
    console.log(`[MonthlyBilling] Shop ${shopId} missing usageLineItemId`);
    return null;
  }

  if (!bypassBilling && shop.billingStatus !== "ACTIVE" && shop.billingStatus !== "TRIAL") {
    console.log(`[MonthlyBilling] Shop ${shopId} billing status is ${shop.billingStatus}, skipping`);
    return null;
  }

  const planConfig = getPlanConfig(shop.billingPlan);

  // Period = previous calendar month, clamped to install/activation date.
  // For new installs whose first calendar month begins partway through, the
  // install anchor is `currentPeriodStart` (set during activateBilling) so
  // we don't bill them for days before they had access.
  const fullMonth = getPreviousCalendarMonth(now);
  const installAnchor = shop.currentPeriodStart;
  const periodStart =
    installAnchor && installAnchor > fullMonth.start ? installAnchor : fullMonth.start;
  const periodEnd = fullMonth.end;
  const daysInPeriod = daysBetween(periodStart, periodEnd);
  const daysInFullMonth = daysBetween(fullMonth.start, fullMonth.end);

  // Skip if period start is after period end (install happened after the
  // period being processed — nothing to do).
  if (periodStart > periodEnd) {
    console.log(`[MonthlyBilling] Shop ${shopId} install ${installAnchor?.toISOString()} after period end ${periodEnd.toISOString()}`);
    return null;
  }

  // Step 1: reconcile missing events from Order rows.
  const reconciliation = await reconcileEventsForPeriod(shopId, periodStart, periodEnd);
  if (reconciliation.paidEventsAdded > 0 || reconciliation.refundedEventsAdded > 0) {
    console.log(
      `[MonthlyBilling] Shop ${shop.shopifyDomain} reconciliation added ${reconciliation.paidEventsAdded} paid, ${reconciliation.refundedEventsAdded} refunded events`
    );
  }

  // Step 2: aggregate events in window that haven't been reported yet.
  const events = await prisma.billingEvent.findMany({
    where: {
      shopId,
      occurredAt: { gte: periodStart, lte: periodEnd },
      reportedAt: null,
    },
    select: { id: true, type: true, amountCents: true },
  });

  const paidEvents = events.filter((e) => e.type === "PAID");
  const refundedEvents = events.filter((e) => e.type === "REFUNDED");
  const paidTotalCents = paidEvents.reduce((sum, e) => sum + e.amountCents, 0);
  const refundedTotalCents = refundedEvents.reduce((sum, e) => sum + e.amountCents, 0);
  const netRevenueCents = Math.max(0, paidTotalCents - refundedTotalCents);
  const revenueShareCents = Math.round(netRevenueCents * (planConfig.revenueSharePercent / 100));

  // Step 3: prorated extra rep charges.
  const activeRepCount = await prisma.salesRep.count({
    where: { shopId, isActive: true },
  });
  const extraCount = Math.max(0, activeRepCount - planConfig.includedReps);
  const prorationFactor = daysInPeriod / daysInFullMonth;
  const proratedChargeCents = Math.round(extraCount * planConfig.perRepCents * prorationFactor);

  // Step 4: open or get the BillingPeriod for this window. We do this here
  // rather than at activation so the audit table reflects exactly what was
  // billed (with the right plan + included-reps snapshot).
  const billingPeriod = await prisma.billingPeriod.upsert({
    where: { shopId_periodStart: { shopId, periodStart } },
    create: {
      shopId,
      periodStart,
      periodEnd,
      plan: shop.billingPlan,
      includedReps: planConfig.includedReps,
      perRepCents: planConfig.perRepCents,
      revenueSharePercent: planConfig.revenueSharePercent,
      activeRepCount,
      extraRepCount: extraCount,
      orderRevenueCents: netRevenueCents,
      revenueShareCents,
      repChargesCents: proratedChargeCents,
      extraRepsCharged: extraCount,
    },
    update: {
      activeRepCount,
      extraRepCount: extraCount,
      orderRevenueCents: netRevenueCents,
      revenueShareCents,
      repChargesCents: proratedChargeCents,
      extraRepsCharged: extraCount,
    },
  });

  const result: MonthlyUsageResult = {
    shopId: shop.id,
    shopDomain: shop.shopifyDomain,
    period: { start: periodStart, end: periodEnd, daysInPeriod, daysInFullMonth },
    reconciliation,
    revenueShare: {
      paidEventCount: paidEvents.length,
      refundedEventCount: refundedEvents.length,
      paidTotalCents,
      refundedTotalCents,
      netRevenueCents,
      revenueShareCents,
      reported: false,
    },
    extraReps: {
      activeCount: activeRepCount,
      includedCount: planConfig.includedReps,
      extraCount,
      proratedChargeCents,
      reported: false,
    },
    billingPeriodId: billingPeriod.id,
  };

  const periodKey = periodStart.toISOString().slice(0, 7); // YYYY-MM

  // Step 5a: report revenue share.
  if (revenueShareCents > 0) {
    const description = `Revenue share for ${periodKey} (${planConfig.revenueSharePercent}% of $${(netRevenueCents / 100).toFixed(2)} net)`;
    const idempotencyKey = `revenue-${shopId}-${periodKey}`;

    if (bypassBilling) {
      result.revenueShare.reported = true;
      console.log(`[MonthlyBilling] ${shop.shopifyDomain} bypassed: revenue share $${(revenueShareCents / 100).toFixed(2)}`);
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
    }
  } else {
    result.revenueShare.reported = true;
  }

  // Step 5b: report extra rep charges.
  if (proratedChargeCents > 0) {
    const description = `Extra sales reps for ${periodKey} (${extraCount} × $${(planConfig.perRepCents / 100).toFixed(2)}, prorated ${daysInPeriod}/${daysInFullMonth} days)`;
    const idempotencyKey = `reps-${shopId}-${periodKey}`;

    if (bypassBilling) {
      result.extraReps.reported = true;
      console.log(`[MonthlyBilling] ${shop.shopifyDomain} bypassed: extra reps $${(proratedChargeCents / 100).toFixed(2)}`);
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
    }
  } else {
    result.extraReps.reported = true;
  }

  // Step 6: tag all events with the billing period + usage record. This is
  // the audit trail — every event is permanently anchored to a cycle.
  const reportedAt = new Date();
  const eventIds = events.map((e) => e.id);
  if (eventIds.length > 0) {
    await prisma.billingEvent.updateMany({
      where: { id: { in: eventIds } },
      data: {
        billingPeriodId: billingPeriod.id,
        shopifyUsageRecordId: result.revenueShare.usageRecordId ?? null,
        reportedAt,
      },
    });
  }

  // Step 7: close this period; advance shop to current month.
  const currentMonth = getCalendarMonthBoundaries(now);
  await prisma.$transaction([
    prisma.billingPeriod.update({
      where: { id: billingPeriod.id },
      data: { status: "closed", finalizedAt: reportedAt },
    }),
    prisma.shop.update({
      where: { id: shopId },
      data: {
        currentPeriodStart: currentMonth.start,
        currentPeriodEnd: currentMonth.end,
      },
    }),
  ]);

  console.log(
    `[MonthlyBilling] ${shop.shopifyDomain} ${periodKey}: $${(netRevenueCents / 100).toFixed(2)} net revenue → $${(revenueShareCents / 100).toFixed(2)} share, ${extraCount} extra reps → $${(proratedChargeCents / 100).toFixed(2)}`
  );

  return result;
}

/**
 * Recompute the denormalized `Order.paidAmountCents` and
 * `Order.refundedAmountCents` columns from the BillingEvent ledger. Use
 * this after a backfill, or any time the running totals might have drifted
 * from the ledger (e.g. manual DB edits, partial migrations).
 *
 * Authoritative source = `BillingEvent`. Order columns are always rebuilt
 * to match: `paidAmountCents = sum(PAID events)`, `refundedAmountCents =
 * sum(REFUNDED events)`.
 *
 * Idempotent — running this twice gives the same result.
 */
export async function recomputeOrderAmountsFromEvents(
  shopId?: string
): Promise<{ ordersUpdated: number }> {
  // Group sums by orderId + type. Skip rows with no orderId (manual adjustments).
  const groups = await prisma.billingEvent.groupBy({
    by: ["orderId", "type"],
    where: {
      orderId: { not: null },
      ...(shopId && { shopId }),
    },
    _sum: { amountCents: true },
  });

  // Reduce to one row per order with the two totals.
  const totals = new Map<string, { paid: number; refunded: number }>();
  for (const g of groups) {
    if (!g.orderId) continue;
    const t = totals.get(g.orderId) ?? { paid: 0, refunded: 0 };
    if (g.type === "PAID") t.paid = g._sum.amountCents ?? 0;
    if (g.type === "REFUNDED") t.refunded = g._sum.amountCents ?? 0;
    totals.set(g.orderId, t);
  }

  let ordersUpdated = 0;
  for (const [orderId, t] of totals) {
    await prisma.order.update({
      where: { id: orderId },
      data: { paidAmountCents: t.paid, refundedAmountCents: t.refunded },
    });
    ordersUpdated++;
  }

  return { ordersUpdated };
}

/**
 * One-shot migration helper: walk every existing Order with paidAt or
 * refundedAt and create matching BillingEvent rows, then resync the
 * denormalized Order amount columns from the ledger. Idempotent — safe to
 * re-run.
 */
export async function backfillBillingEventsFromOrders(
  /** Optional: limit to a single shop */
  shopId?: string
): Promise<{
  paidCreated: number;
  refundedCreated: number;
  ordersScanned: number;
  ordersResynced: number;
}> {
  const orders = await prisma.order.findMany({
    where: {
      ...(shopId && { shopId }),
      OR: [{ paidAt: { not: null } }, { refundedAt: { not: null } }],
    },
    select: {
      id: true,
      shopId: true,
      totalCents: true,
      paidAt: true,
      refundedAt: true,
    },
  });

  let paidCreated = 0;
  let refundedCreated = 0;

  for (const o of orders) {
    if (o.paidAt) {
      const before = await prisma.billingEvent.count({
        where: { shopId: o.shopId, orderId: o.id, type: "PAID" },
      });
      await recordBillingEvent({
        shopId: o.shopId,
        orderId: o.id,
        type: "PAID",
        amountCents: o.totalCents,
        occurredAt: o.paidAt,
        source: "backfill",
      });
      const after = await prisma.billingEvent.count({
        where: { shopId: o.shopId, orderId: o.id, type: "PAID" },
      });
      if (after > before) paidCreated++;
    }
    if (o.refundedAt) {
      const before = await prisma.billingEvent.count({
        where: { shopId: o.shopId, orderId: o.id, type: "REFUNDED" },
      });
      await recordBillingEvent({
        shopId: o.shopId,
        orderId: o.id,
        type: "REFUNDED",
        amountCents: o.totalCents,
        occurredAt: o.refundedAt,
        source: "backfill",
      });
      const after = await prisma.billingEvent.count({
        where: { shopId: o.shopId, orderId: o.id, type: "REFUNDED" },
      });
      if (after > before) refundedCreated++;
    }
  }

  // Resync the denormalized columns from the ledger. This handles the
  // migration case where events already existed before the columns were
  // added (recordBillingEvent's increment-on-new-event wouldn't have run).
  const { ordersUpdated } = await recomputeOrderAmountsFromEvents(shopId);

  return {
    paidCreated,
    refundedCreated,
    ordersScanned: orders.length,
    ordersResynced: ordersUpdated,
  };
}
