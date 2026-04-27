# Companies

B2B account management and Shopify sync.

## Overview

Companies represent B2B customers with multiple locations and contacts. Companies can be:
- **Shopify-managed**: Synced from Shopify B2B (Shopify Plus)
- **App-managed**: Created directly in the app

## Structure

The company structure mirrors Shopify's B2B model:

```
Company
│
├── Contacts (who buys)
│   ├── Contact info (name, email, phone)
│   ├── → Shopify Company Contact
│   └── → Shopify Customer (for payment methods)
│
└── Locations (where to ship)
    ├── Address info (street, city, state, zip)
    ├── → Shopify Company Location
    └── → Territory (auto-assigned by address)
```

## Shopify B2B Mapping

| App Entity | Shopify B2B Entity | Purpose |
|------------|-------------------|---------|
| `Company` | Company | B2B account/organization |
| `CompanyLocation` | Company Location | Shipping/billing addresses |
| `CompanyContact` | Company Contact | Person at the company |
| `CompanyContact.shopifyCustomerId` | Customer | Payment methods, order history |

### Why Two Shopify Records for Contacts?

In Shopify B2B:
- **Company Contact** = Person associated with a company
- **Customer** = The account that can have payment methods and place orders

A contact links to both:
- `shopifyContactId` → The Company Contact record
- `shopifyCustomerId` → The Customer record (for payment method vaulting)

## Data Model

### Company
```typescript
{
  id: string;
  shopId: string;
  shopifyCompanyId?: string;    // Numeric ID if synced from Shopify
  name: string;
  accountNumber?: string;       // External ID / account number
  paymentTerms: PaymentTerms;   // DUE_ON_ORDER, NET_30, etc.
  assignedRepId?: string;       // Direct rep assignment
  isActive: boolean;
  syncStatus: SyncStatus;
  lastSyncedAt?: Date;
  locations: CompanyLocation[];
  contacts: CompanyContact[];
}
```

### CompanyLocation
```typescript
{
  id: string;
  companyId: string;
  shopifyLocationId?: string;   // Numeric ID if synced
  name: string;
  address1?: string;
  address2?: string;
  city?: string;
  province?: string;
  provinceCode?: string;        // State code: "CA", "NY"
  zipcode?: string;
  country: string;
  countryCode: string;
  phone?: string;
  isPrimary: boolean;
  isShippingAddress: boolean;
  isBillingAddress: boolean;
  territoryId?: string;         // Auto-assigned based on address
}
```

### CompanyContact
```typescript
{
  id: string;
  companyId: string;
  shopifyContactId?: string;    // Numeric ID
  shopifyCustomerId?: string;   // Linked Shopify customer
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  isPrimary: boolean;
  canPlaceOrders: boolean;
}
```

## Shopify B2B Import

Import companies from Shopify Admin (requires Shopify Plus):

```typescript
import { importCompaniesFromShopify } from "~/services/company.server";

const result = await importCompaniesFromShopify(shopId, admin);
// { success: true, imported: 25, updated: 10 }
```

### What Gets Imported

- Company name and external ID
- All company locations with addresses
- Company contacts (linked to Shopify customers)

### Automatic Territory Alignment

After import, each location is automatically aligned to a territory:

```typescript
// Called for each imported location
await alignLocationToTerritory(shopId, locationId);
```

## Shopify-Managed vs App-Managed

| Feature | Shopify-Managed | App-Managed |
|---------|-----------------|-------------|
| Source | Imported from Shopify | Created in app |
| `shopifyCompanyId` | Set | null |
| Edit name/account# | No (managed in Shopify) | Yes |
| Edit payment terms | No | Yes |
| Assign rep | Yes | Yes |
| Deactivate | No | Yes |

```typescript
// Check if Shopify-managed
const isShopifyManaged = company.shopifyCompanyId !== null;
```

## Key Functions

### company.server.ts

| Function | Description |
|----------|-------------|
| `getCompanies(shopId)` | List companies |
| `getCompanyById(shopId, id)` | Company with locations/contacts |
| `createCompany(input)` | Create app-managed company |
| `updateCompany(shopId, id, input)` | Update company |
| `updateCompanyRepAssignment(...)` | Assign rep |
| `deactivateCompany(shopId, id)` | Soft delete (app-managed only) |
| `importCompaniesFromShopify(...)` | Bulk import from Shopify |
| `alignLocationToTerritory(...)` | Assign location to territory |

## Usage in Orders

When creating an order, both contacts and locations are referenced:

```typescript
Order {
  companyId           // The company
  contactId           // Who is buying (receives invoice, has payment method)
  shippingLocationId  // Where to ship
  billingLocationId   // Billing address
}
```

**Contact** → Determines:
- Who receives the invoice email
- Which Shopify Customer is linked (for payment methods)
- Order attribution in Shopify

**Location** → Determines:
- Shipping address on the order
- Which territory the order falls under
- Which sales reps have access

## Customer Sync

Contacts are synced to Shopify as Customers for payment method vaulting and order attribution.

### Sync Flow

```
Create Contact → syncContactToShopifyCustomer() → Shopify Customer created
                                                         ↓
                                                   shopifyCustomerId saved

Update Contact → updateShopifyCustomer() → Shopify Customer updated
```

### Automatic Sync

Use `upsertContactWithShopifySync()` for automatic sync on create/update:

```typescript
import { upsertContactWithShopifySync } from "~/services/customer.server";

// Create new contact (syncs to Shopify automatically)
const result = await upsertContactWithShopifySync(companyId, {
  firstName: "John",
  lastName: "Doe",
  email: "john@example.com",
  phone: "555-1234",
  isPrimary: true,
}, admin);

// Update existing contact (syncs to Shopify automatically)
const result = await upsertContactWithShopifySync(companyId, {
  id: existingContactId,
  firstName: "John",
  lastName: "Smith", // Changed
  email: "john@example.com",
}, admin);
```

### Manual Sync Functions

| Function | Description |
|----------|-------------|
| `syncContactToShopifyCustomer(contactId, admin)` | Create/link Shopify Customer |
| `updateShopifyCustomer(contactId, admin)` | Update existing Shopify Customer |
| `syncCompanyContactsToShopify(companyId, admin)` | Bulk sync all contacts |
| `getContactPaymentMethods(contactId, admin)` | Get saved payment methods |

### What Gets Synced

| Contact Field | Shopify Customer Field |
|---------------|------------------------|
| `firstName` | `firstName` |
| `lastName` | `lastName` |
| `email` | `email` |
| `phone` | `phone` |

**Note:** Payment methods are managed entirely in Shopify and read-only from the app.

## Rep Assignment

Companies can be assigned to reps in two ways:

1. **Direct Assignment** - `company.assignedRepId`
2. **Territory-Based** - Rep has access via location's territory

```typescript
// Direct assignment
await updateCompanyRepAssignment(shopId, companyId, repId);

// Territory access (automatic)
// Location in territory → Rep assigned to territory → Rep can access company
```

## Routes

| Route | Purpose |
|-------|---------|
| `app.companies._index.tsx` | Company list |
| `app.companies.$id.tsx` | Company detail/edit |
| `app.companies.create.tsx` | Create company |

## Webhooks

Company data is kept in sync via webhooks. **All webhook routes enqueue
to the [job queue](./queue.md)** — receive handlers acknowledge in <50ms
and the worker dispatches to the registered handlers async with retries.

| Topic | Trigger | Action (in worker) |
|-------|---------|--------|
| `companies/create` | Company created in Shopify | `processCompanyWebhook` — import to DB |
| `companies/update` | Company modified | `processCompanyWebhook` — update local record |
| `companies/delete` | Company deleted | `processCompanyWebhook` — deactivate |
| `company_locations/create` | Location added | `syncCompanyDetails` — full company sync (picks up payment terms via GraphQL) |
| `company_locations/update` | Location modified | `syncCompanyDetails` — full company sync |
| `company_locations/delete` | Location removed | `processCompanyLocationWebhook` — deactivate |
| `company_contacts/create` | Contact added | `syncCompanyDetails` — full company sync |
| `company_contacts/update` | Contact modified | `syncCompanyDetails` — full company sync |
| `company_contacts/delete` | Contact removed | direct `companyContact.deleteMany` by `(companyId, shopifyContactId)` |
| `customer_payment_methods/create` | Vaulted card added | `syncCustomerPaymentMethodsWebhook` |
| `customer_payment_methods/update` | Vaulted card updated | same |
| `customer_payment_methods/revoke` | Vaulted card revoked | same |

Failed handler runs are retried 5 times with exponential backoff (the
`WEBHOOK` kind profile in `services/queue/queue.server.ts`). Permanent
failures are visible via `SELECT * FROM queue_jobs WHERE status = 'FAILED'`
or the queue admin view.

## Payment Terms

| Value | Description |
|-------|-------------|
| `DUE_ON_ORDER` | Payment due immediately |
| `NET_7` | Due in 7 days |
| `NET_15` | Due in 15 days |
| `NET_30` | Due in 30 days |
| `NET_60` | Due in 60 days |
| `NET_90` | Due in 90 days |
