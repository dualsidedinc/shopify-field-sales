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

Usage is reported **daily** via a batch process, not in real-time. This approach:
- Handles high volume (thousands of orders/month)
- Reduces API calls to Shopify
- Allows proper netting of refunds

### Daily Batch Process

Runs daily at 00:05 UTC via GitHub Actions:

```yaml
# .github/workflows/daily-billing.yml
on:
  schedule:
    - cron: '5 0 * * *'
```

Triggers `POST /api/cron/billing` which processes all active shops.

### Revenue Share Calculation

Net revenue share is calculated as:

```
(Orders PAID) - (Orders REFUNDED) = Net Revenue
Net Revenue × Revenue Share % = Daily Charge
```

```typescript
const paidTotal = paidOrders.reduce((sum, o) => sum + o.totalCents, 0);
const refundedTotal = refundedOrders.reduce((sum, o) => sum + o.totalCents, 0);
const netRevenueCents = paidTotal - refundedTotal;
const revenueShareCents = Math.max(0, Math.round(
  netRevenueCents * (planConfig.revenueSharePercent / 100)
));
```

Orders are tracked via `revenueShareReportedAt` to prevent double-billing.

### Extra Rep Charges (Prorated)

Extra reps beyond the included count are charged with proration based on days remaining in the billing period:

```typescript
// Calculate prorated charge
const daysRemaining = Math.ceil((periodEnd - now) / msPerDay);
const prorationFactor = Math.min(1, daysRemaining / 30);
const proratedCharge = fullCharge × prorationFactor;
```

Example: If a shop adds 2 extra reps with 15 days left at $10/rep:
- Full charge: 2 × $10 = $20
- Proration: 15/30 = 0.5
- Actual charge: $20 × 0.5 = $10

The `extraRepsCharged` field tracks reps already billed in the current period to prevent duplicate charges.

## Database Schema

### Order Tracking Fields

```prisma
model Order {
  // Revenue share tracking
  revenueShareReportedAt    DateTime?  // When reported to Shopify
  revenueShareUsageRecordId String?    // Shopify usage record ID
}
```

### Billing Period Tracking

```prisma
model BillingPeriod {
  // Extra rep tracking
  extraRepsCharged Int @default(0)  // Reps already billed this period

  // Accumulated totals
  activeRepCount    Int?
  extraRepCount     Int?
  repChargesCents   Int @default(0)
  orderRevenueCents Int @default(0)
  revenueShareCents Int @default(0)
}
```

## Key Functions

### billing.server.ts

| Function | Description |
|----------|-------------|
| `getPlanConfig(plan)` | Get plan configuration |
| `getBillingStatus(shopId)` | Current billing status |
| `hasActiveBilling(shopId)` | Check if subscription active |
| `createBillingSubscription(...)` | Create Shopify subscription (redirects to approval) |
| `activateBilling(shopId, subscriptionId, plan)` | Activate after approval |
| `getCurrentBillingPeriod(shopId)` | Get/create current period |
| `calculateUsageCharges(shopId)` | Calculate pending charges |
| `reportDailyUsageForShop(shopId, admin)` | Report daily usage to Shopify |
| `getShopsForDailyUsageReporting()` | Get shops needing daily reporting |
| `reportUsageCharge(...)` | Report single usage charge to Shopify |
| `handleSubscriptionUpdate(...)` | Process billing webhook |
| `cancelBilling(shopId)` | Cancel subscription |
| `syncUsageLineItemId(admin, shopId)` | Sync usage line item ID from Shopify |
| `getBillingDashboardData(shopId)` | Dashboard data |

## Webhooks

Register these in `shopify.app.toml`:

```toml
[[webhooks.subscriptions]]
topics = [ "app_subscriptions/update" ]
uri = "/webhooks/billing"

[[webhooks.subscriptions]]
topics = [ "app_subscriptions/approaching_capped_amount" ]
uri = "/webhooks/billing"

[[webhooks.subscriptions]]
topics = [ "app/uninstalled" ]
uri = "/webhooks/billing"
```

| Topic | Action |
|-------|--------|
| `APP_SUBSCRIPTIONS_UPDATE` | Update billing status (ACTIVE, FROZEN, CANCELLED), handle period transitions |
| `APP_SUBSCRIPTIONS_APPROACHING_CAPPED_AMOUNT` | Warning when near 90% of usage cap |
| `APP_UNINSTALLED` | Cancel billing |

> **Note**: `subscription_billing_attempts/*` webhooks are for **merchant subscription contracts** (subscription products sold to customers), not app billing. They require `read_own_subscription_contracts` scope with partner approval. For app billing, subscription status changes (including payment failures) come through `APP_SUBSCRIPTIONS_UPDATE` with status `FROZEN`.

## Routes

| Route | Purpose |
|-------|---------|
| `app.billing._index.tsx` | Billing dashboard |
| `app.billing.subscribe.tsx` | Plan selection |
| `app.billing.callback.tsx` | Post-approval callback |
| `api.cron.billing.tsx` | Daily usage reporting endpoint |

## Cron Endpoint

The daily billing cron is protected by `APP_SECRET`:

```typescript
// api.cron.billing.tsx
export const action = async ({ request }: ActionFunctionArgs) => {
  const secret = request.headers.get("x-app-secret");
  if (APP_SECRET && secret !== APP_SECRET) {
    return new Response("Unauthorized", { status: 401 });
  }

  const shops = await getShopsForDailyUsageReporting();

  for (const shop of shops) {
    const { admin } = await unauthenticated.admin(shop.shopifyDomain);
    await reportDailyUsageForShop(shop.id, admin);
  }

  return Response.json({ success: true, ... });
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

### 2. Set GitHub Secrets

For the daily billing GitHub Action:

| Secret | Description |
|--------|-------------|
| `SHOPIFY_APP_URL` | Your app's production URL (e.g., `https://your-app.fly.dev`) |
| `APP_SECRET` | Secret key to protect the cron endpoint |

### 3. Environment Variables

```bash
# .env
APP_SECRET=your-secret-key-here

# Optional: For custom distributions only
# BYPASS_SHOPIFY_BILLING=true
```

## Testing

Set `isTest: true` when creating subscription for development:

```typescript
await createBillingSubscription(shopId, plan, admin, returnUrl, true);
```

Test subscriptions don't charge real money.

### Testing Daily Billing

Trigger manually via GitHub Actions "Run workflow" or:

```bash
curl -X POST "https://your-app.fly.dev/api/cron/billing" \
  -H "x-app-secret: your-secret"
```

## Idempotency

All usage records use idempotency keys to prevent duplicate charges:

```typescript
// Revenue share: one per shop per day
`revenue-${shopId}-${today}`

// Extra reps: per shop, day, and rep count
`reps-${shopId}-${today}-${activeRepCount}`
```

If the same key is used twice, Shopify ignores the duplicate.
