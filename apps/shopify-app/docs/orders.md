# Orders

Order management and Shopify integration in the Shopify app.

## Overview

Orders are created in field-app and synced to Shopify via this app. The admin can approve orders, trigger Shopify sync, and monitor order status.

## Order Lifecycle

```
┌─────────────────────────────────────────────────────────────────────┐
│                          FIELD APP                                  │
├─────────────────────────────────────────────────────────────────────┤
│  DRAFT ──────► AWAITING_REVIEW                                     │
│  (Sales rep      (Submitted for                                    │
│   editing)        approval)                                        │
└─────────────────────────────────────────────────────────────────────┘
                        │
                        ▼ Admin approves
┌─────────────────────────────────────────────────────────────────────┐
│                        SHOPIFY APP                                  │
├─────────────────────────────────────────────────────────────────────┤
│  PENDING ──────► PAID ──────► REFUNDED                             │
│  (Invoice        (Payment     (Refund                              │
│   sent)           received)    processed)                          │
│      │                                                              │
│      └──────► CANCELLED                                            │
└─────────────────────────────────────────────────────────────────────┘
```

## Order Status

| Status | Description | Editable |
|--------|-------------|----------|
| `DRAFT` | Being edited by sales rep | Yes (field-app) |
| `AWAITING_REVIEW` | Submitted for admin approval | Yes (shopify-app only) |
| `PENDING` | Synced to Shopify, awaiting payment | No |
| `PAID` | Payment received | No |
| `CANCELLED` | Order cancelled | No |
| `REFUNDED` | Payment refunded | No |

### AWAITING_REVIEW Editing

Admins can edit orders in `AWAITING_REVIEW` status via the shopify-app. All changes are tracked as timeline events:

- Company, contact, location changes
- Line item additions, removals, quantity changes
- Shipping method changes
- PO number and note updates

The SaveBar only appears when user-editable fields change (not for auto-calculated fields like tax, discounts, or promotions).

## Shopify Integration

### Draft Order Flow

When admin approves an order:

1. **Create Draft Order** - Order synced to Shopify as draft order
2. **Send Invoice** - Invoice emailed to customer contact
3. **Customer Pays** - Customer pays via Shopify checkout
4. **Order Created** - Draft converts to real Shopify order
5. **Webhook Updates** - Status synced back to database

### Draft Order Input

When syncing an order to Shopify, we populate the full `DraftOrderInput`:

```typescript
const input = {
  // Line items with catalog/promotion pricing
  lineItems: [
    {
      variantId: "gid://shopify/ProductVariant/123",
      title: "Widget Pro",
      quantity: 5,
      originalUnitPrice: "85.00",  // Catalog price or base price
      sku: "WGT-PRO-001",
      appliedDiscount: {           // Line-item promotion discount
        value: 10.00,
        valueType: "FIXED_AMOUNT",
        title: "10% Volume Discount"
      }
    }
  ],

  // Attribution & tracking
  tags: ["FieldSale"],             // For reporting/filtering
  sourceName: "Field Sales App",   // Channel attribution
  customAttributes: [
    { key: "salesRepId", value: "rep_123" },
    { key: "salesRepName", value: "John Smith" },
    { key: "fieldSalesOrderId", value: "order_456" }
  ],

  // Customer info
  email: "buyer@company.com",
  phone: "+1-555-123-4567",
  note: "Deliver to loading dock",
  poNumber: "PO-2024-001",
  presentmentCurrencyCode: "USD",

  // Addresses
  shippingAddress: { address1, city, province, zip, country },
  billingAddress: { address1, city, province, zip, country },

  // Shipping
  shippingLine: {
    title: "Standard Ground",
    price: "15.00"
  },

  // Order-level discount (ORDER_TOTAL promotions)
  appliedDiscount: {
    value: 50.00,
    valueType: "FIXED_AMOUNT",
    title: "Order Discount"
  },

  // B2B Company Assignment
  purchasingEntity: {
    purchasingCompany: {
      companyId: "gid://shopify/Company/789",
      companyLocationId: "gid://shopify/CompanyLocation/456",
      companyContactId: "gid://shopify/CompanyContact/123"
    }
  }
};
```

### Key Fields Explained

| Field | Purpose |
|-------|---------|
| `tags: ["FieldSale"]` | Identifies orders from field sales app |
| `sourceName` | Shows "Field Sales App" in Shopify admin |
| `customAttributes` | Links order to sales rep for commission tracking |
| `metafields` | App-specific data (territory, sales rep info) |
| `purchasingEntity` | Assigns B2B company (auto-applies payment terms) |
| `appliedDiscount` (line) | Promotion discounts per line item |
| `appliedDiscount` (order) | Order-total promotions |
| `shippingLine` | Selected shipping method and price |

## Order Metafields

Orders are enriched with app-specific metafields under the `field_sales` namespace. These are set automatically when draft orders are created in Shopify.

### Metafield Definitions

| Key | Name | Description |
|-----|------|-------------|
| `territory_code` | Territory Code | The code of the territory this order was placed from |
| `territory_name` | Territory Name | The name of the territory this order was placed from |
| `sales_rep_external_id` | Sales Rep External ID | The external ID of the sales rep who placed this order |
| `sales_rep_name` | Sales Rep Name | The name of the sales rep who placed this order |

### Use Cases

These metafields enable:
- **Reporting**: Filter and group orders by territory or sales rep in Shopify reports
- **Integrations**: Sync order data with external systems (ERP, CRM)
- **Commission Tracking**: Identify sales rep for commission calculations
- **Analytics**: Build dashboards based on territory performance

### Metafield Setup

Metafield definitions are created automatically:

1. **New Installs**: Created during OAuth via `afterAuth` hook
2. **First Order**: Checked when syncing order to Shopify (lazy setup)
3. **Manual**: Settings → "Setup Order Metafields" button

The shop's `metafieldsSetupAt` timestamp caches whether setup is complete.

### Metafield Service

```typescript
// services/metafield.server.ts

// Ensure definitions exist (idempotent)
await ensureOrderMetafieldDefinitions(admin);

// Check if shop needs setup
const isSetup = await isMetafieldSetupComplete(shopId);

// Ensure setup with caching (safe to call on every order)
await ensureMetafieldSetupForShop(shopId, admin);

// Build metafields for a draft order
const metafields = buildOrderMetafields({
  territoryCode: "WEST-001",
  territoryName: "Western Region",
  salesRepExternalId: "EMP-123",
  salesRepName: "John Smith",
});

// Set metafields on existing order
await setOrderMetafields(admin, orderGid, metafieldData);
```

### Data Flow

```
┌─────────────────────────────────────────────────────────────┐
│                    ORDER SYNC TO SHOPIFY                    │
├─────────────────────────────────────────────────────────────┤
│  1. ensureMetafieldSetupForShop(shopId, admin)             │
│     └─► Creates definitions if not already set up           │
│                                                             │
│  2. Collect metafield data from order:                      │
│     - Territory code/name from shipping location or company │
│     - Sales rep external ID and name                        │
│                                                             │
│  3. Include metafields in draft order input:                │
│     input.metafields = buildOrderMetafields(data)           │
│                                                             │
│  4. Draft order created with metafields attached            │
│     └─► Metafields copy to real order when completed        │
└─────────────────────────────────────────────────────────────┘
```

### GraphQL Mutations

```typescript
// Create draft order
await admin.graphql(DRAFT_ORDER_CREATE_MUTATION, {
  variables: { input }  // Full input as shown above
});

// Send invoice (for DUE_ON_ORDER without card)
await admin.graphql(DRAFT_ORDER_INVOICE_SEND_MUTATION, {
  variables: { id, email: { to, subject, customMessage } }
});

// Complete draft order (convert to real order)
await admin.graphql(DRAFT_ORDER_COMPLETE_MUTATION, {
  variables: { id, paymentPending }
});
```

### ID Mapping

Shopify uses GIDs (Global IDs) in GraphQL. The app stores numeric IDs:

```typescript
// Shopify GID: "gid://shopify/DraftOrder/12345"
// Database:    "12345"

import { toGid, fromGid } from "../lib/shopify-ids";

// For GraphQL queries
const gid = toGid("DraftOrder", "12345"); // "gid://shopify/DraftOrder/12345"

// From webhook payload
const numericId = fromGid("gid://shopify/Order/67890"); // "67890"
```

## Webhooks

### Order Webhooks

| Topic | Trigger | Action |
|-------|---------|--------|
| `ORDERS_CREATE` | Order created | Link to local order |
| `ORDERS_PAID` | Payment received | Update status to PAID |
| `ORDERS_CANCELLED` | Order cancelled | Update status to CANCELLED |
| `ORDERS_UPDATED` | Order modified | Check for refund status |

### Draft Order Webhooks

| Topic | Trigger | Action |
|-------|---------|--------|
| `DRAFT_ORDERS_UPDATE` | Status change | Link Shopify order when completed |

### Webhook Processing

```typescript
// routes/webhooks.orders.tsx
export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop, payload } = await authenticate.webhook(request);

  await processOrderWebhook(shop, topic, payload);

  return new Response(null, { status: 200 });
};
```

## Payment Terms & Processing

### Overview

Orders use payment terms from Shopify B2B Company Locations. When a shipping location is selected, its payment terms are automatically applied to the order.

### Payment Terms Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                    ORDER CREATION                                   │
├─────────────────────────────────────────────────────────────────────┤
│  1. Select Company                                                  │
│  2. Select Contact (with vaulted payment methods)                   │
│  3. Select Shipping Location (with payment terms)                   │
│     └─► Payment terms auto-applied from location                    │
│  4. Select Payment Method (if contact has vaulted cards)            │
│     └─► Or choose "Send Invoice Instead"                            │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    PAYMENT PROCESSING                               │
├─────────────────────────────────────────────────────────────────────┤
│  DUE_ON_ORDER:                                                      │
│    └─► Charge card immediately OR send invoice on order placement   │
│                                                                     │
│  NET_15 / NET_30 / NET_45 / NET_60:                                │
│    └─► Daily cron processes due orders                              │
│        ├─► If vaulted card: Charge via Shopify                     │
│        └─► If no card: Send payment invoice                        │
└─────────────────────────────────────────────────────────────────────┘
```

### Payment Terms Types

| Terms Type | Description | Due Date |
|------------|-------------|----------|
| `DUE_ON_ORDER` | Payment required immediately | Order placement |
| `DUE_ON_RECEIPT` | Due when order received | Fulfillment |
| `NET_15` | Net 15 days | 15 days from order |
| `NET_30` | Net 30 days | 30 days from order |
| `NET_45` | Net 45 days | 45 days from order |
| `NET_60` | Net 60 days | 60 days from order |

### Vaulted Payment Methods

Payment methods are synced from Shopify's Customer Payment Methods and stored per contact:

```typescript
interface PaymentMethod {
  id: string;
  provider: "SHOPIFY_VAULT" | "SHOPIFY_TERMS";
  externalMethodId: string;  // Shopify payment method ID
  last4?: string;            // Card last 4 digits
  brand?: string;            // Visa, Mastercard, etc.
  expiryMonth?: number;
  expiryYear?: number;
  isDefault: boolean;
}
```

### Payment Processing Cron

A GitHub Actions workflow runs daily to process due orders:

**File**: `.github/workflows/daily-payments.yml`

**Schedule**: Daily at 6:00 UTC (1am EST)

**Process**:
1. Find orders with `status: PENDING` and `paymentDueDate <= now`
2. For orders with `paymentMethodId`:
   - Charge via Shopify's `orderMarkAsPaid` mutation
   - On success: Update status to `PAID`
   - On failure: Send invoice as fallback
3. For orders without payment method:
   - Send invoice via `draftOrderInvoiceSend`
   - Store `shopifyInvoiceId` for tracking

**API Endpoint**: `POST /api/cron/payments`

```bash
# Manual trigger (requires APP_SECRET)
curl -X POST https://your-app.fly.dev/api/cron/payments \
  -H "x-app-secret: $APP_SECRET"

# Check due orders without processing
curl "https://your-app.fly.dev/api/cron/payments?secret=$APP_SECRET"
```

### Data Sources

| Data | Source | Synced From |
|------|--------|-------------|
| Payment Terms | `CompanyLocation.paymentTermsType` | Shopify B2B `buyerExperienceConfiguration` |
| Payment Methods | `PaymentMethod` table | Shopify `CustomerPaymentMethod` |
| Due Date | Calculated | Order date + terms days |

## Order Timeline

Orders have a timeline that tracks all significant events and changes after submission. This provides an audit trail and allows for communication between sales reps and admins.

### Timeline Events

Events are only tracked after an order is submitted for approval (status: `AWAITING_REVIEW`). Draft orders do not have timeline events.

| Event Type | Description | Trigger |
|------------|-------------|---------|
| `submitted` | Order submitted for approval | Sales rep submits draft |
| `approved` | Order approved by admin | Admin approves |
| `declined` | Order declined by admin | Admin declines (returns to DRAFT) |
| `cancelled` | Order cancelled | Admin cancels |
| `paid` | Payment received | Webhook or manual mark |
| `refunded` | Payment refunded | Webhook |
| `comment` | Manual comment added | User adds comment |
| `company_changed` | Company updated | Post-submission edit |
| `contact_changed` | Contact updated | Post-submission edit |
| `shipping_location_changed` | Shipping address changed | Post-submission edit |
| `line_item_added` | Product added | Post-submission edit |
| `line_item_removed` | Product removed | Post-submission edit |
| `line_item_quantity_changed` | Quantity changed | Post-submission edit |
| `promotion_applied` | Promotion added | Post-submission edit |
| `promotion_removed` | Promotion removed | Post-submission edit |

### Author Types

| Type | Description |
|------|-------------|
| `SALES_REP` | Action by sales representative |
| `ADMIN` | Action by admin user in Shopify app |
| `SYSTEM` | Automated system action |

### Timeline UI

The timeline section appears in the OrderForm for all orders (visible in readonly mode for completed orders). Features:

- **Chronological display**: Events shown newest first
- **Comments on actions**: Submit, Approve, and Decline actions allow optional comments
- **Add comment**: Admins can add standalone comments to any order
- **Event icons**: Visual indicators for different event types

### Data Model

```typescript
interface OrderTimelineEvent {
  id: string;
  orderId: string;
  authorType: "SALES_REP" | "ADMIN" | "SYSTEM";
  authorId?: string;        // Sales rep or admin ID
  authorName: string;       // Display name
  eventType: string;        // See event types above
  metadata?: Record<string, unknown>;  // Event-specific data
  comment?: string;         // Optional user comment
  createdAt: Date;
}
```

### Key Functions

| Function | Description |
|----------|-------------|
| `getOrderTimeline(orderId)` | Get all timeline events for an order |
| `addTimelineEvent(input)` | Add a new event to the timeline |
| `addSystemTimelineEvent(...)` | Add system-generated event |
| `trackOrderChanges(...)` | Track field changes (for future use) |

## Data Model

### Order
```typescript
{
  id: string;
  shopId: string;
  companyId: string;
  salesRepId: string;
  orderNumber: string;           // "ORD-000001"
  status: OrderStatus;

  // Shopify IDs (numeric, not GIDs)
  shopifyDraftOrderId?: string;  // "12345"
  shopifyOrderId?: string;       // "67890"
  shopifyOrderNumber?: string;   // "#1001"

  // Addresses
  shippingLocationId?: string;
  billingLocationId?: string;

  // Totals (in cents)
  subtotalCents: number;
  discountCents: number;
  shippingCents: number;
  taxCents: number;              // Calculated via Shopify API
  totalCents: number;

  // Promotions
  appliedPromotionIds: string[]; // IDs of applied promotions (ORDER_TOTAL, SHIPPING scope)

  // Payment
  paymentTerms: PaymentTerms;    // DUE_ON_ORDER, NET_30, etc.
  paymentDueDate?: Date;         // Calculated due date
  paymentMethodId?: string;      // Selected vaulted card
  shopifyInvoiceId?: string;     // If invoice sent

  // Timestamps
  placedAt?: Date;
  paidAt?: Date;
  cancelledAt?: Date;
  refundedAt?: Date;
}
```

### OrderLineItem
```typescript
{
  id: string;
  orderId: string;
  shopifyProductId?: string;     // Numeric ID
  shopifyVariantId?: string;     // Numeric ID
  sku?: string;
  title: string;
  variantTitle?: string;
  quantity: number;
  unitPriceCents: number;
  discountCents: number;
  taxCents: number;
  totalCents: number;
}
```

## Key Functions

### order.server.ts

| Function | Description |
|----------|-------------|
| `getOrders(shopId)` | List orders with filtering |
| `getOrderById(shopId, orderId)` | Get order details |
| `createOrder(input)` | Create new order |
| `updateOrderLineItems(...)` | Modify line items |
| `syncOrderToShopifyDraft(...)` | Create Shopify draft order |
| `submitOrderForPayment(...)` | Send invoice to customer |
| `completeDraftOrder(...)` | Convert draft to real order |
| `processOrderWebhook(...)` | Handle order webhook |
| `processDraftOrderWebhook(...)` | Handle draft order webhook |
| `getOrderTimeline(orderId)` | Get timeline events |
| `addTimelineEvent(input)` | Add timeline event |
| `addSystemTimelineEvent(...)` | Add system event |
| `trackOrderChanges(...)` | Track field changes |

## Routes

| Route | Purpose |
|-------|---------|
| `app.orders._index.tsx` | Order list |
| `app.orders.$id.tsx` | Order detail/actions |

## Billing Integration

When orders are marked PAID, they're recorded for revenue share billing:

```typescript
// In markOrderPaid()
await recordBilledOrder(orderId, billingPeriodId, planConfig.revenueSharePercent);
```

See [Billing](./billing.md) for details on revenue share calculation.
