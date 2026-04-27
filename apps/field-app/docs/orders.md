# Orders

Order management in the Field Sales app.

## Order Status Flow

```
DRAFT → AWAITING_REVIEW → PENDING → PAID/CANCELLED/REFUNDED
  ↑           ↑              ↑
Sales rep   Admin in      Shopify
edits       shopify-app   statuses
            approves
```

### Status Definitions

| Status | Description | Editable |
|--------|-------------|----------|
| `DRAFT` | Sales rep is building/editing the order | Yes |
| `AWAITING_REVIEW` | Submitted for admin approval in shopify-app | No |
| `PENDING` | Approved and synced to Shopify as draft order | No |
| `PAID` | Payment received | No |
| `CANCELLED` | Order cancelled | No |
| `REFUNDED` | Order refunded | No |

## OrderForm Component

The `OrderForm` is the main component for creating and editing orders. It provides a mobile-first UX with bottom sheet modals for selection.

### Usage

```tsx
import { OrderForm } from '@/components/orders/OrderForm';

// Create mode
<OrderForm mode="create" companyId={companyId} onSuccess={(id) => router.push(`/orders/${id}`)} />

// Edit mode
<OrderForm mode="edit" orderId={orderId} initialData={orderData} />
```

### Props

| Prop | Type | Description |
|------|------|-------------|
| `mode` | `'create' \| 'edit'` | Form mode |
| `companyId` | `string?` | Pre-select company (create mode) |
| `orderId` | `string?` | Order ID (edit mode) |
| `initialData` | `InitialOrderData?` | Pre-populated form data |
| `onSuccess` | `(orderId: string) => void` | Callback after save |

### Form Sections

The OrderForm is composed of modular sections:

```
┌─────────────────────────────────────┐
│ StatusActions (edit mode only)      │  Status badge + action buttons
├─────────────────────────────────────┤
│ CompanySection                      │  Company → Contact → Location
├─────────────────────────────────────┤
│ ProductsSection                     │  Line items + Add Products
├─────────────────────────────────────┤
│ OrderSummary                        │  Subtotal, shipping select, tax, total
├─────────────────────────────────────┤
│ PaymentSection                      │  Payment terms, due date
├─────────────────────────────────────┤
│ OrderAttributes                     │  PO number, notes
├─────────────────────────────────────┤
│ TimelineSection (edit mode)         │  Order history, comments
└─────────────────────────────────────┘
│ SaveBar (floating, when dirty)      │  Save / Discard - blocks navigation
└─────────────────────────────────────┘
```

### Hooks

#### useOrderForm

Manages form state with dirty checking. The `isDirty` state only tracks user-editable fields (not auto-calculated values like tax, discounts, or promotions):

```typescript
const {
  formData,
  isDirty,           // Only true for user-editable field changes
  resetForm,
  updateInitialRef,
  setCompany,
  setContact,
  setShippingLocation,
  addLineItem,
  updateLineItemQuantity,
  removeLineItem,
  setShippingOption,
  setNote,
  setPoNumber,
  updateTotals,
} = useOrderForm(initialData);
```

**User-editable fields** (affect SaveBar):
- Company, contact, locations
- Line items (non-free items)
- Shipping option
- PO number, notes

**Auto-calculated fields** (don't affect SaveBar):
- Tax, discounts, totals
- Applied promotions, free items

#### usePromotions

Evaluates cart against active promotions with catalog-aware pricing for free items:

```typescript
const { availablePromotions, loading, evaluateCart } = usePromotions({
  locationId: shippingLocation?.id,  // For catalog-aware free item pricing
});

// On line item change
const result = evaluateCart(lineItems);
// result: { lineItems, appliedPromotions, lineItemDiscountCents, orderDiscountCents, discountCents }
```

The `locationId` ensures free items from promotions (BUY_X_GET_Y, SPEND_GET_FREE) use the correct catalog pricing for the selected shipping location.

## Picker Components

All pickers use the BottomSheet pattern for mobile-friendly selection.

### CompanyPicker

```tsx
<CompanyPicker
  selected={company}
  onSelect={(company) => handleCompanyChange(company)}
  label="Company"
  placeholder="Select a company..."
/>
```

### ContactPicker

Filtered by company. Automatically clears when company changes.

```tsx
<ContactPicker
  companyId={company?.id || null}
  selected={contact}
  onSelect={(contact) => handleContactChange(contact)}
  label="Contact"
/>
```

### LocationPicker

Filtered by company. Supports shipping-only and billing-only filters.

```tsx
<LocationPicker
  companyId={company?.id || null}
  selected={shippingLocation}
  onSelect={(location) => handleLocationChange(location)}
  label="Shipping Location"
  shippingOnly
/>
```

### ProductPicker

Multi-select product picker with variant selection:

```tsx
<ProductPicker
  onSelect={(products) => handleAddProducts(products)}
  buttonLabel="Add Products"
  multiple
/>
```

## Entry Points

| Route | Description |
|-------|-------------|
| `/orders` | Orders list with "New Order" button |
| `/orders/create` | New order creation page |
| `/orders/create?companyId=xxx` | New order with pre-selected company |
| `/orders/[id]` | Order detail/edit page |
| `/companies/[id]/order` | New order from company page |

## Order Creation Flow

1. Rep navigates to `/orders/create` or clicks "New Order" from company
2. Selects company (cascades to clear contact/location)
3. Selects contact and shipping location
4. Adds products via ProductPicker
5. Promotions auto-evaluate on line item changes
6. Selects shipping method
7. Optionally adds PO number and notes
8. Clicks "Submit for Approval"
9. Order status changes to `AWAITING_REVIEW`

## API Endpoints

> All mutation endpoints (`POST`, `PUT`, `DELETE`) on the field-app side are thin proxies. The actual logic lives on shopify-app under matching `/api/internal/orders/*` routes. See [`docs/architecture.md`](../../../docs/architecture.md) for the proxy pattern. Reads (`GET`) are direct DB queries from field-app.

### List Orders
```
GET /api/orders?page=1&pageSize=20&companyId=xxx
```
Returns paginated list of orders for the authenticated rep.

### Get Order Detail
```
GET /api/orders/[id]
```
Returns full order with line items, company info, totals.

### Create Order
```
POST /api/orders
Body: {
  companyId: string,
  contactId?: string,
  shippingLocationId?: string,
  billingLocationId?: string,
  lineItems: Array<{
    shopifyProductId: string,
    shopifyVariantId: string,
    sku?: string,
    title: string,
    variantTitle?: string,
    imageUrl?: string,
    quantity: number,
    unitPriceCents: number,
    isFreeItem?: boolean,         // True for promotion-added items
    promotionId?: string,         // Source promotion ID
    promotionName?: string,       // For display
  }>,
  appliedPromotionIds?: string[],
  shippingMethodId?: string,
  subtotalCents?: number,
  discountCents?: number,
  shippingCents?: number,
  taxCents?: number,
  totalCents?: number,
  note?: string,
  poNumber?: string,
  submitForApproval?: boolean,
}
```

When `lineItems` includes items with `isFreeItem: true`, the API uses them directly without re-evaluating promotions. This preserves the correct product titles and catalog-aware pricing set by the form.

### Update Order
```
PUT /api/orders/[id]
Body: { ...same as create }
```

### Submit for Approval
```
POST /api/orders/[id]/submit
Body: { comment?: string }
```

### Approve Order (admin)
```
POST /api/orders/[id]/approve
Body: { comment?: string }
```

### Decline Order (admin)
```
POST /api/orders/[id]/decline
Body: { comment?: string }
```

### Add Comment
```
POST /api/orders/[id]/comments
Body: { comment: string }
```

### Get Promotions
```
GET /api/promotions
```
Returns active promotions for promotion engine evaluation.

### Get Shipping Methods
```
GET /api/shipping-methods
```
Returns available shipping methods with prices.

## Data Models

### Order
```typescript
{
  id: string;
  shopId: string;
  companyId: string;
  salesRepId: string;
  orderNumber: string;           // Internal: FS-1001 (no leading zeros)
  shopifyDraftOrderId?: string;  // After sync to Shopify
  shopifyOrderId?: string;       // After completion
  shopifyOrderNumber?: string;   // Shopify's #1001
  status: OrderStatus;
  subtotalCents: number;
  discountCents: number;
  shippingCents: number;
  taxCents: number;
  totalCents: number;
  currency: string;
  paymentTerms: PaymentTerms;
  appliedPromotionIds: string[]; // IDs of ORDER_TOTAL/SHIPPING scope promotions
  placedAt?: Date;
  lineItems: OrderLineItem[];
}
```

### OrderLineItem
```typescript
{
  id: string;
  orderId: string;
  shopifyProductId?: string;
  shopifyVariantId?: string;
  sku?: string;
  title: string;
  variantTitle?: string;
  imageUrl?: string;
  quantity: number;
  unitPriceCents: number;
  discountCents: number;
  taxCents: number;
  totalCents: number;
  isFreeItem?: boolean;        // From promotions
  promotionId?: string;        // Source promotion
  promotionName?: string;      // For display
}
```

## Key Files

| File | Purpose |
|------|---------|
| `src/components/orders/OrderForm.tsx` | Main form orchestrator |
| `src/components/orders/CompanySection.tsx` | Company/Contact/Location |
| `src/components/orders/ProductsSection.tsx` | Line items management |
| `src/components/orders/OrderSummary.tsx` | Totals and shipping |
| `src/components/orders/StatusActions.tsx` | Submit/Approve/Decline |
| `src/components/orders/TimelineSection.tsx` | Order history |
| `src/hooks/useOrderForm.ts` | Form state management |
| `src/hooks/usePromotions.ts` | Promotion evaluation |
| `src/components/pickers/*.tsx` | Selection components |
| `src/components/ui/BottomSheet.tsx` | Modal component (z-60, above SaveBar) |
| `src/components/ui/SaveBar.tsx` | Floating save bar with navigation blocking |
| `src/components/ui/SaveBarContext.tsx` | Dirty state management |
| `src/components/ui/BackButton.tsx` | Back navigation with dirty check |
| `src/app/api/orders/route.ts` | GET (list) and POST (create) |
| `src/app/api/orders/[id]/route.ts` | GET, PUT, PATCH |
| `src/app/api/promotions/route.ts` | Active promotions |
| `src/app/api/shipping-methods/route.ts` | Shipping methods |

## SaveBar & Navigation Blocking

The SaveBar floats above the bottom navigation and blocks navigation when changes are unsaved.

### Behavior
- **Floating Position**: Fixed above bottom nav with accent border for visibility
- **Navigation Blocking**: Back button and bottom nav are blocked when dirty
- **Shake Animation**: SaveBar shakes when user attempts to navigate away
- **z-index Layering**: SaveBar (z-50) < BottomSheet (z-60) so pickers remain usable

### Implementation
```tsx
// SaveBarContext provides dirty state across components
const { isDirty, setIsDirty, triggerShake, isShaking } = useSaveBarContext();

// BackButton checks dirty state before navigation
<BackButton href="/orders" />

// BottomNav blocks navigation when dirty
const handleNavClick = (href: string) => {
  if (isDirty) {
    triggerShake();
  } else {
    router.push(href);
  }
};
```

### OrderSummary Shipping
The shipping method selector is inline with the price display:
- Dropdown on left with subtle border styling
- Price on right, shows "—" when no option selected
- Loading spinner next to "Estimated Tax" during calculation

## Promotion Integration

When line items change, the promotion engine recalculates discounts:

1. Fetches active promotions for the shop
2. Checks conditions (min quantity, min order total, product eligibility)
3. Applies discounts by type:
   - `PERCENTAGE` - X% off applicable items
   - `FIXED_AMOUNT` - $X off per item
   - `BUY_X_GET_Y` - Buy X get Y free
   - `SPEND_GET_FREE` - Spend $X get free item
4. Adds free items to line items with `isFreeItem: true`
5. Updates order totals

See [Promotions](./promotions.md) for detailed promotion logic.
