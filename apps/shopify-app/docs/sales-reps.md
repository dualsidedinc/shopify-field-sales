# Sales Reps

Sales representative management and territory access.

## Overview

Sales reps are users of the field-app mobile application. They're managed in the shopify-app admin and can be assigned to territories to control their account access.

## Data Model

### SalesRep
```typescript
{
  id: string;
  shopId: string;
  externalId?: string;        // Optional business identifier
  email: string;
  firstName: string;
  lastName: string;
  phone?: string;
  role: RepRole;              // REP, MANAGER
  isActive: boolean;
  passwordHash: string;
  activatedAt?: Date;         // For billing tracking
  deactivatedAt?: Date;       // For billing tracking
  repTerritories: RepTerritory[];
  companies: Company[];       // Direct assignments
}
```

### External ID

The optional `externalId` field provides a business identifier for the sales rep. This is useful for:
- Integration with external systems (ERP, CRM, payroll)
- Commission tracking
- Reporting and analytics

The external ID is automatically set as a Shopify order metafield when orders are placed. See [Orders](./orders.md#order-metafields) for details.

### RepTerritory
```typescript
{
  id: string;
  repId: string;
  territoryId: string;
  isPrimary: boolean;         // First territory is primary
}
```

## Roles

| Role | Description | Field App Access |
|------|-------------|------------------|
| `REP` | Sales representative | Own territories only |
| `MANAGER` | Sales manager | All territories, team data |

## Territory-Based Access

Reps access companies through territory assignments:

```
Rep → RepTerritory → Territory → CompanyLocation → Company
```

```typescript
// Get all companies a rep can access
const companies = await getCompaniesByRepTerritories(shopId, repId);

// Returns companies where any location is in rep's territories
[
  {
    id: "company-1",
    name: "Acme Corp",
    locationId: "loc-1",
    locationName: "Main Office",
    territoryId: "terr-1",
    territoryName: "California",
  },
  // ...
]
```

### Unique Companies

Get distinct companies (not per-location):

```typescript
const companies = await getUniqueCompaniesByRepTerritories(shopId, repId);

// Returns:
[
  {
    id: "company-1",
    name: "Acme Corp",
    accountNumber: "ACC-001",
    territories: ["California", "Nevada"],  // All territories with locations
  },
]
```

## Key Functions

### salesRep.server.ts

| Function | Description |
|----------|-------------|
| `getSalesReps(shopId)` | List all reps with counts |
| `getActiveSalesReps(shopId)` | Active reps (for dropdowns) |
| `getSalesRepById(shopId, id)` | Rep details with territories/companies |
| `createSalesRep(input)` | Create rep with territories |
| `updateSalesRep(shopId, id, input)` | Update rep |
| `deactivateSalesRep(shopId, id)` | Soft delete (tracks for billing) |
| `activateSalesRep(shopId, id)` | Reactivate (tracks for billing) |
| `getCompaniesByRepTerritories(...)` | Companies via territories |
| `getUniqueCompaniesByRepTerritories(...)` | Distinct companies |

## Creating a Sales Rep

```typescript
const result = await createSalesRep({
  shopId,
  firstName: "John",
  lastName: "Smith",
  email: "john@example.com",
  phone: "555-1234",
  externalId: "EMP-001",              // Optional business identifier
  role: "REP",
  territoryIds: ["terr-1", "terr-2"],  // First is primary
});
```

Notes:
- Email must be unique per shop
- First territory in array is marked as primary
- `activatedAt` is set automatically for billing
- `externalId` is optional and used for external system integration

### Input Types

```typescript
interface CreateSalesRepInput {
  shopId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string | null;
  externalId?: string | null;    // Optional business identifier
  role?: RepRole;
  territoryIds?: string[];
  approvalThresholdCents?: number | null;
}

interface UpdateSalesRepInput {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string | null;
  externalId?: string | null;    // Update external ID
  role?: RepRole;
  territoryIds?: string[];
  approvalThresholdCents?: number | null;
}
```

## Updating Territory Assignments

```typescript
await updateSalesRep(shopId, repId, {
  territoryIds: ["terr-3", "terr-4"],  // Replace all assignments
});
```

This will:
1. Delete all existing `RepTerritory` records
2. Create new records for specified territories
3. Mark first territory as primary

## Billing Integration

Rep counts affect billing:
- Each active rep is counted toward the plan limit
- Extra reps beyond included count incur per-rep charges
- `activatedAt`/`deactivatedAt` timestamps track billing periods

See [Billing](./billing.md) for pricing details.

## Routes

| Route | Purpose |
|-------|---------|
| `app.reps._index.tsx` | Sales rep list |
| `app.reps.$id.tsx` | Rep detail/edit |
| `app.reps.create.tsx` | Create rep |

## Rep Detail View

The detail page shows:

```typescript
{
  // Basic info
  firstName, lastName, email, phone, role,

  // Territories (via RepTerritory)
  territories: [
    { id, name, isPrimary, companyCount }
  ],

  // Direct company assignments (via Company.assignedRepId)
  companies: [
    { id, name, territoryName }
  ],

  // Companies accessible via territories
  territoryCompanies: [
    { id, name, accountNumber, territories: ["CA", "NV"] }
  ],
}
```

## Best Practices

1. **Use Territories** - Prefer territory-based access over direct assignments
2. **Primary Territory** - Set most important territory first for priority
3. **Deactivate vs Delete** - Always deactivate reps to preserve history
4. **Unique Emails** - Each rep needs a unique email within the shop
