# Billing

Subscription billing and usage tracking.

> **Note**: This document covers **app subscription billing** (merchant pays for using the app). For **order payment processing** (customers paying for orders), see [Orders - Payment Terms & Processing](./orders.md#payment-terms--processing).

## Overview

Billing is handled through Shopify's App Billing API. The model includes:
- **Base subscription** - Monthly fee based on plan
- **Per-rep usage** - Charges for reps beyond included count (prorated mid-month)
- **Revenue share** - Percentage of net order revenue

## Plans

| Plan | Included Reps | Per Extra Rep | Base Price | Revenue Share |
|------|---------------|---------------|------------|---------------|
| Basic | 10 | $10/rep | $100/mo | 0.50% |
| Grow | 25 | $9/rep | $200/mo | 0.50% |
| Pro | 50 | $8/rep | $300/mo | 0.45% |
| Plus | 75 | $7/rep | $500/mo | 0.40% |

```typescript
// Plan configuration
const PLAN_CONFIGS: Record<BillingPlan, PlanConfig> = {
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
  // ...
};
```

## Billing Status

| Status | Description |
|--------|-------------|
| `INACTIVE` | No subscription |
| `TRIAL` | In 7-day trial period |
| `ACTIVE` | Paid subscription active |
| `PAST_DUE` | Payment failed |
| `CANCELLED` | Subscription cancelled |

## Subscription Flow

### 1. Create Subscription

When merchant clicks "Select Plan", they are redirected to Shopify to approve:

```typescript
const result = await createBillingSubscription(
  shopId,
  "GROW",           // Plan
  admin,            // Shopify admin API
  returnUrl,        // Callback URL (includes plan param)
  isTest            // Test mode
);

// Returns confirmation URL for merchant to approve
// { success: true, confirmationUrl: "https://...", subscriptionId: "..." }
```

**Important**: The plan is NOT saved until the merchant approves. This uses `replacementBehavior: "APPLY_IMMEDIATELY"` which:
- Replaces any existing subscription atomically when approved
- Maintains current plan if merchant cancels/declines

### 2. Merchant Approves

Merchant is redirected to Shopify to approve charges.

### 3. Activate Billing

After approval, callback triggers activation with the plan from URL params:

```typescript
// Extract plan from return URL
const plan = url.searchParams.get("plan") as BillingPlan;

await activateBilling(shopId, subscriptionId, plan);
```

This:
- Sets `billingPlan` to the approved plan
- Sets `billingStatus` to `TRIAL` (for new subscriptions)
- Sets `trialEndsAt` (7 days)
- Creates/updates billing period
- Backfills `activatedAt` for existing reps

### Plan Changes

When changing plans mid-cycle:
- Shopify handles proration automatically
- We update the billing period with new plan config
- Existing period continues with new pricing
- No need to close/reopen periods

## Usage Reporting

Usage is reported **monthly** on the 1st of each month for the previous calendar month. The flow:

1. **Webhooks** (`orders/paid`, `refunds/create`, `orders/updated`) are enqueued to the [job queue](./queue.md) and processed async by the worker, which writes append-only `BillingEvent` rows as money moves.
2. **Monthly cron** (1st of month at 00:05 UTC) closes the previous calendar month: reconciles missing events, aggregates the ledger, reports a single revenue-share charge + a single prorated extra-rep charge to Shopify, and tags every event with the cycle it was billed in for permanent audit trail.

> **Source of truth for "is this order paid?":** Shopify, not the app. We only write a `BillingEvent { type: PAID }` when the `orders/paid` webhook fires (or when an admin uses the manual "Mark as Paid" override). Completing a draft order via GraphQL leaves the local order at `PENDING` — see [Orders → Status authority](./orders.md#status-authority--who-flips-what) for the full reasoning.

### BillingEvent ledger

Every monetary event is captured as an immutable row:

```prisma
model BillingEvent {
  id                    String           @id @default(cuid())
  shopId                String
  orderId               String?          // null for manual adjustments
  type                  BillingEventType // PAID | REFUNDED | ADJUSTMENT
  amountCents           Int              // always positive; type drives sign
  occurredAt            DateTime         // when Shopify recorded the event
  source                String           // webhook topic or "manual" / "reconciliation"

  // Audit: which billing cycle did this end up in?
  billingPeriodId       String?
  shopifyUsageRecordId  String?
  reportedAt            DateTime?
}
```

The unique index `(shopId, orderId, type, occurredAt)` makes webhook handlers idempotent — duplicate Shopify retries are no-ops.

### Monthly job

Registered as a BullMQ scheduled job (`scheduled.monthly-billing`) in `app/services/queue/schedules.server.ts` with cron pattern `5 0 1 * *` (1st of each month at 00:05 UTC). Runs in the `field-sales-queue-worker` Render service.

For each shop with an active plan, `reportMonthlyUsageForShop`:

1. **Determines the period** — previous calendar month, clamped to install date for first-period new installs (so a shop installed on the 15th only pays for days 15→end of month).
2. **Reconciles** — `reconcileEventsForPeriod` diffs `Order.paidAt`/`refundedAt` against `BillingEvent` rows in the window and creates any missing events. Catches webhook delivery gaps.
3. **Aggregates** — sums `BillingEvent` rows in the window:
   ```
   netRevenue        = sum(PAID) - sum(REFUNDED)
   revenueShareCents = max(0, round(netRevenue × plan.revenueSharePercent / 100))
   ```
4. **Computes prorated extra-rep charges**:
   ```
   prorationFactor    = daysInPeriod / daysInFullMonth
   proratedRepCharge  = extraReps × perRepCents × prorationFactor
   ```
5. **Reports to Shopify** — one revenue-share record + one extra-rep record, with idempotency keys `revenue-${shopId}-${YYYY-MM}` and `reps-${shopId}-${YYYY-MM}`.
6. **Tags every event** in the batch with `billingPeriodId` + `shopifyUsageRecordId` + `reportedAt`. This is the audit trail — every event is permanently anchored to a cycle.
7. **Closes the period** (status `closed`, `finalizedAt` set) and advances `Shop.currentPeriodStart`/`currentPeriodEnd` to the new calendar month.

### Mid-month installs

The first cycle is partial. A shop installed on **April 15**:

- `BillingPeriod`: `periodStart = Apr 15`, `periodEnd = Apr 30 23:59:59`.
- Revenue share: events with `occurredAt >= Apr 15` only (automatic — no earlier events exist).
- Extra-rep proration: `extraReps × perRepCents × (16 / 30)`.
- Base monthly fee: Shopify's billing API prorates this automatically.
- May 1 cron fires: closes April, opens May (`May 1 → May 31`), reports April's net to Shopify.

After the first partial period, every cycle is a full calendar month.

### Reconciliation guarantee

Even if a webhook delivery fails:

```typescript
// Inside reportMonthlyUsageForShop, before aggregation
await reconcileEventsForPeriod(shopId, periodStart, periodEnd);
```

…walks every `Order` with `paidAt` or `refundedAt` in the window and creates any missing `BillingEvent` rows from order data. So the canonical event ledger always matches reality at cycle close.

### Backfill

For an existing deployment moving to the ledger model:

```typescript
import { backfillBillingEventsFromOrders } from "./services/billing.server";

await backfillBillingEventsFromOrders();          // all shops
await backfillBillingEventsFromOrders("shop-id"); // one shop
```

Walks every Order with `paidAt`/`refundedAt` and creates events. Idempotent — safe to re-run.

## Database Schema

### BillingEvent (the canonical ledger)

```prisma
model BillingEvent {
  shopId                String
  orderId               String?
  type                  BillingEventType  // PAID | REFUNDED | ADJUSTMENT
  amountCents           Int
  occurredAt            DateTime
  source                String

  billingPeriodId       String?           // set when included in a cycle
  shopifyUsageRecordId  String?
  reportedAt            DateTime?

  @@unique([shopId, orderId, type, occurredAt])
}
```

### BillingPeriod (one per shop per calendar month)

```prisma
model BillingPeriod {
  periodStart       DateTime  // 1st of month, or install date for first period
  periodEnd         DateTime  // last millisecond of month

  includedReps      Int
  activeRepCount    Int @default(0)
  extraRepCount     Int @default(0)
  repChargesCents   Int @default(0)

  orderRevenueCents Int @default(0)  // net (paid - refunded) for the period
  revenueShareCents Int @default(0)

  status            String    @default("open")  // open | closed
  finalizedAt       DateTime?

  events            BillingEvent[]  // every event tagged in this cycle
}
```

### Order denormalized totals

`Order` carries running totals that mirror the BillingEvent ledger so the
order-detail UI can show "Paid: $X / Refunded: $Y / Net: $Z" without
joining:

```prisma
model Order {
  paidAmountCents     Int @default(0)  // sum of PAID events for this order
  refundedAmountCents Int @default(0)  // sum of REFUNDED events for this order
  // net = paidAmountCents - refundedAmountCents
}
```

Maintained by `recordBillingEvent` — atomically incremented in the same
transaction as the `BillingEvent` insert. Resyncable from the ledger via
`recomputeOrderAmountsFromEvents()` if drift is ever suspected.

### Legacy Order tracking fields

`Order.revenueShareReportedAt` and `Order.revenueShareUsageRecordId` predate
the ledger model and are no longer written to. They can be dropped after the
old data is verified to be replicated in `BillingEvent`.

## Key Functions

### billing.server.ts

| Function | Description |
|----------|-------------|
| `getPlanConfig(plan)` | Get plan configuration |
| `getBillingStatus(shopId)` | Current billing status |
| `hasActiveBilling(shopId)` | Check if subscription active |
| `createBillingSubscription(...)` | Create Shopify subscription (redirects to approval) |
| `activateBilling(shopId, subscriptionId, plan)` | Activate after approval — sets `currentPeriodEnd` to month-end |
| `getCurrentBillingPeriod(shopId)` | Get/create current period |
| `calculateUsageCharges(shopId)` | Pending charges for the current month (reads `BillingEvent` ledger) |
| **`recordBillingEvent(...)`** | **Idempotent insert into the BillingEvent ledger — called from webhooks** |
| **`reconcileEventsForPeriod(...)`** | **Backfill missing events from `Order` rows for a date window** |
| **`reportMonthlyUsageForShop(shopId, admin, now?)`** | **Close previous month: reconcile, aggregate, report to Shopify, tag events** |
| **`backfillBillingEventsFromOrders(shopId?)`** | **One-shot migration helper — creates events + resyncs Order amount columns** |
| **`recomputeOrderAmountsFromEvents(shopId?)`** | **Rebuild `Order.paidAmountCents` / `refundedAmountCents` from the ledger. Idempotent.** |
| `getCalendarMonthBoundaries(date)` | `{ start, end }` for the calendar month containing `date` |
| `getPreviousCalendarMonth(date)` | `{ start, end }` for the calendar month before `date` |
| `getShopsForDailyUsageReporting()` | Shops needing the monthly run (name unchanged for backwards compat) |
| `reportUsageCharge(...)` | Low-level: report single usage charge to Shopify |
| `handleSubscriptionUpdate(...)` | Process billing webhook |
| `cancelBilling(shopId)` | Cancel subscription |
| `syncUsageLineItemId(admin, shopId)` | Sync usage line item ID from Shopify |
| `getBillingDashboardData(shopId)` | Dashboard data |

## Webhooks

Subscriptions in `shopify.app.toml` that drive billing-relevant flows:

```toml
[[webhooks.subscriptions]]
topics = [ "app_subscriptions/update", "app_subscriptions/approaching_capped_amount" ]
uri = "/webhooks/billing"

[[webhooks.subscriptions]]
topics = [ "app/uninstalled" ]
uri = "/webhooks/app/uninstalled"

[[webhooks.subscriptions]]
topics = [ "orders/paid", "orders/cancelled", "orders/updated" ]
uri = "/webhooks/orders"

[[webhooks.subscriptions]]
topics = [ "refunds/create" ]
uri = "/webhooks/refunds"
```

All five routes enqueue to the [job queue](./queue.md) — they acknowledge
in <50ms and the worker handles processing. The exception is
`/webhooks/app/uninstalled` which is **hybrid**: it deletes the OAuth
session inline (auth-critical) AND enqueues the business-side cleanup
(`cancelBilling`).

| Topic | Action |
|-------|--------|
| `APP_SUBSCRIPTIONS_UPDATE` | Update billing status (ACTIVE, FROZEN, CANCELLED), handle period transitions |
| `APP_SUBSCRIPTIONS_APPROACHING_CAPPED_AMOUNT` | Warning when near 90% of usage cap (currently logs only — TODO: notify merchant + auto-bump) |
| `APP_UNINSTALLED` | Cancel billing |
| `ORDERS_PAID` / `ORDERS_UPDATED` (paid transition) | Write `BillingEvent { type: PAID }` |
| `REFUNDS_CREATE` | Write `BillingEvent { type: REFUNDED }` |

> **Note**: `subscription_billing_attempts/*` webhooks are for **merchant subscription contracts** (subscription products sold to customers), not app billing. They require `read_own_subscription_contracts` scope with partner approval. For app billing, subscription status changes (including payment failures) come through `APP_SUBSCRIPTIONS_UPDATE` with status `FROZEN`.

## Routes

| Route | Purpose |
|-------|---------|
| `app.billing._index.tsx` | Billing dashboard |
| `app.billing.subscribe.tsx` | Plan selection |
| `app.billing.callback.tsx` | Post-approval callback |

## Scheduled Job

Monthly usage reporting runs as a BullMQ scheduled job, not an HTTP endpoint. Schedule key `monthly-billing` in `app/services/queue/schedules.server.ts` (cron `5 0 1 * *` UTC, i.e., 00:05 on the 1st). Handler: `handleMonthlyBilling` in `app/services/queue/handlers/actions.server.ts`.

```typescript
// app/services/queue/handlers/actions.server.ts (excerpt)
const handleMonthlyBilling: JobHandler = async () => {
  const now = new Date();
  const shops = await getShopsForDailyUsageReporting();

  for (const shop of shops) {
    const { admin } = await unauthenticated.admin(shop.shopifyDomain);
    // ...sync usage line item id if missing, then:
    await reportMonthlyUsageForShop(shop.id, admin, now);
  }
};
```

### Response Format

```json
{
  "success": true,
  "timestamp": "2024-01-15T00:05:00.000Z",
  "summary": {
    "shopsProcessed": 10,
    "successful": 9,
    "errors": 1,
    "totalRevenueShareCents": 25000,
    "totalRepChargesCents": 5000,
    "totalChargesCents": 30000
  },
  "results": [...],
  "errors": [...]
}
```

## Dashboard Data

```typescript
const data = await getBillingDashboardData(shopId);

// Returns:
{
  shop: { billingPlan, billingStatus, trialEndsAt, ... },
  status: { isActive, isTrial, trialDaysRemaining, ... },
  usage: { activeRepCount, extraRepCount, repChargesCents, ... },
  planConfig: { name, includedReps, perRepCents, ... },
  history: [ /* past billing periods */ ],
  allPlans: [ /* all available plans */ ],
}
```

## Trial Period

- **Duration**: 7 days
- **Features**: Full access to all plan features
- **End of Trial**: Must approve charges or lose access

```typescript
const status = await getBillingStatus(shopId);

if (status.isTrial) {
  console.log(`Trial ends in ${status.trialDaysRemaining} days`);
}

if (status.requiresBilling) {
  // Redirect to billing page
}
```

### Trial Expiration Handling

When a trial expires, the shop is treated as a **new subscription** if they select a plan. This means:
- Expired trials get a fresh 7-day trial period
- This ensures shops that let their trial lapse can re-engage

```typescript
// In activateBilling()
const trialExpired = shop.billingStatus === "TRIAL" && shop.trialEndsAt && now > shop.trialEndsAt;
const isNewSubscription = shop.billingStatus === "INACTIVE" || shop.billingStatus === "CANCELLED" || trialExpired;
```

### Trial Extension Prevention

**Important**: Active trials cannot be extended by changing plans. This prevents abuse where shops could perpetually extend their trial by switching between plans.

When a shop changes plans during an active trial:
- The existing `trialEndsAt` date is preserved
- Only the plan configuration changes (pricing, included reps, etc.)
- The billing period is updated with new plan settings

```typescript
if (isNewSubscription) {
  // New subscription: set new trial period
  trialEndsAt = new Date(now);
  trialEndsAt.setDate(trialEndsAt.getDate() + TRIAL_DAYS);
  billingStatus = "TRIAL";
} else {
  // Plan change: keep existing status and trial end date
  // trialEndsAt is NOT set here - existing date preserved
  billingStatus = shop.billingStatus === "TRIAL" ? "TRIAL" : "ACTIVE";
}
```

## Custom App Distributions (Bypass Shopify Billing)

For custom app distributions where billing is handled outside Shopify (e.g., direct contracts with enterprise clients), you can bypass the Shopify Billing API while still tracking usage locally.

### Configuration

Set this environment variable on your custom instance:

```bash
BYPASS_SHOPIFY_BILLING=true
```

**Note:** Only set this for custom distribution instances. Standard instances should NOT set this variable (or leave it unset) - Shopify Billing will be used normally.

### Behavior When Bypassed

| Function | Normal | Bypassed |
|----------|--------|----------|
| `getBillingStatus()` | Checks subscription status | Returns `isActive: true`, `requiresBilling: false` |
| `reportDailyUsageForShop()` | Reports to Shopify API | Logs locally, skips API call |
| `getShopsForDailyUsageReporting()` | Active shops with subscriptions | All shops with a billing plan |

### What Gets Tracked Locally

Even with Shopify Billing bypassed, usage is still calculated and stored in the database:

| Data | Location |
|------|----------|
| Revenue share per period | `BillingPeriod.revenueShareCents` |
| Extra rep charges | `BillingPeriod.repChargesCents` |
| Active/extra rep counts | `BillingPeriod.activeRepCount`, `extraRepCount` |
| Order reporting timestamps | `Order.revenueShareReportedAt` |
| Usage record IDs | `Order.revenueShareUsageRecordId` (prefixed with `local-`) |

### Querying Usage for Custom Billing

```typescript
// Get usage for a billing period
const period = await prisma.billingPeriod.findFirst({
  where: { shopId, status: "open" },
});

console.log({
  revenueShare: period.revenueShareCents / 100,
  extraReps: period.extraRepCount,
  repCharges: period.repChargesCents / 100,
});
```

### Helper Function

```typescript
import { shouldBypassShopifyBilling } from "./services/billing.server";

if (shouldBypassShopifyBilling()) {
  // Custom billing logic
}
```

## Setup & Deployment

### 1. Deploy Webhooks

```bash
shopify app deploy
```

### 2. Environment Variables

```bash
# .env
# App handle for billing callback URLs (must match Partner Dashboard)
# Production: field-sales-manager
# Development: field-sales-manager-dev
SHOPIFY_APP_HANDLE=field-sales-manager

# Optional: For custom distributions only
# BYPASS_SHOPIFY_BILLING=true
```

The monthly billing job runs inside the BullMQ worker (`field-sales-queue-worker` Render service). No HTTP secret is required — the worker pulls jobs from Redis directly.

### App Handle Configuration

The `SHOPIFY_APP_HANDLE` environment variable is **critical** for billing callbacks to work correctly in embedded apps.

When a merchant approves a subscription, Shopify redirects back to:
```
https://admin.shopify.com/store/{store}/apps/{app-handle}/app/billing/callback?plan={plan}
```

The app handle must match what's configured in the Partner Dashboard. Common values:
- **Production**: `field-sales-manager`
- **Development**: `field-sales-manager-dev`

If the handle is wrong, users will see a 404 error after approving billing.

```typescript
// app.billing.subscribe.tsx
const storeName = session.shop.replace(".myshopify.com", "");
const appHandle = process.env.SHOPIFY_APP_HANDLE || "field-sales-manager";
const returnUrl = `https://admin.shopify.com/store/${storeName}/apps/${appHandle}/app/billing/callback?plan=${plan}`;
```

## Testing

Set `isTest: true` when creating subscription for development:

```typescript
await createBillingSubscription(shopId, plan, admin, returnUrl, true);
```

Test subscriptions don't charge real money.

### Testing Monthly Billing

Trigger ad-hoc by enqueueing the action from a Node REPL or admin route:

```ts
import { enqueueJob } from "~/services/queue/enqueue.server";
await enqueueJob({
  kind: "ACTION",
  topic: "scheduled.monthly-billing",
  payload: {},
  source: "manual:admin",
});
```

The job runs in the worker process — tail its logs to see per-shop progress.

## Idempotency

All usage records use idempotency keys to prevent duplicate charges:

```typescript
// Revenue share: one per shop per day
`revenue-${shopId}-${today}`

// Extra reps: per shop, day, and rep count
`reps-${shopId}-${today}-${activeRepCount}`
```

If the same key is used twice, Shopify ignores the duplicate.
