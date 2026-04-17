# Territories

Geographic region management for sales coverage.

## Overview

Territories define geographic regions for sales rep assignment. Company locations are automatically aligned to territories based on address (zipcode or state).

## Data Model

### Territory
```typescript
{
  id: string;
  shopId: string;
  name: string;
  code?: string;                 // Optional identifier (e.g., "WEST-001")
  description?: string;
  isActive: boolean;
  states: TerritoryState[];      // State coverage
  zipcodes: TerritoryZipcode[];  // Zipcode coverage
  locations: CompanyLocation[];  // Assigned locations
  repTerritories: RepTerritory[]; // Assigned reps
}
```

### Territory Code

The optional `code` field provides a business identifier for the territory. This is useful for:
- Integration with external systems (ERP, CRM)
- Reporting and analytics
- Sales rep assignment tracking

The territory code is automatically set as a Shopify order metafield when orders are placed. See [Orders](./orders.md#order-metafields) for details.

### TerritoryState
```typescript
{
  id: string;
  territoryId: string;
  stateCode: string;    // "CA", "NY", etc.
  stateName: string;    // "California", "New York"
}
```

### TerritoryZipcode
```typescript
{
  id: string;
  territoryId: string;
  zipcode: string;      // "90210", "10001"
}
```

## Territory Matching

Locations are matched to territories by address. Priority:

1. **Zipcode** (most specific) - Exact zipcode match
2. **State** - State code match

```typescript
// territory.server.ts
async function findTerritoryByLocation(
  shopId: string,
  zipcode: string | null,
  stateCode: string | null
): Promise<string | null> {
  // First try zipcode match
  if (zipcode) {
    const match = await prisma.territoryZipcode.findFirst({
      where: { zipcode, territory: { shopId, isActive: true } }
    });
    if (match) return match.territoryId;
  }

  // Fall back to state match
  if (stateCode) {
    const match = await prisma.territoryState.findFirst({
      where: { stateCode, territory: { shopId, isActive: true } }
    });
    if (match) return match.territoryId;
  }

  return null;
}
```

## Auto-Alignment

Locations are automatically aligned to territories when:
- Location is created/updated (from Shopify import or manual)
- Territory definition changes
- Bulk realignment is triggered

```typescript
// Align single location
await alignLocationToTerritory(shopId, locationId);

// Realign all locations
await realignAllLocationsToTerritories(shopId);
```

## Key Functions

### territory.server.ts

| Function | Description |
|----------|-------------|
| `getTerritories(shopId)` | List all territories with counts |
| `getActiveTerritories(shopId)` | Active territories (for dropdowns) |
| `getTerritoryById(shopId, id)` | Territory details with relations |
| `createTerritory(input)` | Create territory with states/zips/reps/code |
| `updateTerritory(shopId, id, input)` | Update territory (including code) |
| `deactivateTerritory(shopId, id)` | Soft delete |
| `activateTerritory(shopId, id)` | Reactivate |
| `findTerritoryByLocation(...)` | Match location to territory |
| `realignAllLocationsToTerritories(...)` | Bulk realign |
| `getTerritoryAlignmentReport(...)` | Coverage analysis |

### Territory Input Types

```typescript
interface CreateTerritoryInput {
  shopId: string;
  name: string;
  code?: string | null;        // Optional territory code
  description?: string | null;
  stateCodes?: string[];
  zipcodes?: string[];
  repIds?: string[];
}

interface UpdateTerritoryInput {
  name?: string;
  code?: string | null;        // Update territory code
  description?: string | null;
  stateCodes?: string[];
  zipcodes?: string[];
  repIds?: string[];
}
```

## Alignment Report

Analyze territory coverage gaps:

```typescript
const report = await getTerritoryAlignmentReport(shopId);

// Returns:
{
  summary: {
    totalLocations: 150,
    locationsWithTerritory: 120,
    locationsWithoutTerritory: 30,
    totalTerritories: 5,
    territoriesWithReps: 4,
    territoriesWithoutReps: 1,
  },
  unassignedLocations: [...],
  companiesWithoutTerritories: [...],
  territoriesWithoutReps: [...],
}
```

## Rep Assignment

Reps are assigned to territories via `RepTerritory` join table:

```typescript
{
  repId: string;
  territoryId: string;
  isPrimary: boolean;   // First assigned rep is primary
}
```

A rep can access companies through their assigned territories. See [Sales Reps](./sales-reps.md) for territory-based access.

## Routes

| Route | Purpose |
|-------|---------|
| `app.territories._index.tsx` | Territory list |
| `app.territories.$id.tsx` | Territory detail/edit |
| `app.territories.create.tsx` | Create territory |

## US States Reference

All 50 US states + DC are available:

```typescript
import { US_STATES } from "~/services/territory.server";

// [{ code: "AL", name: "Alabama" }, ...]
```

## Best Practices

1. **Avoid Overlaps** - Don't assign same zipcode/state to multiple territories
2. **Complete Coverage** - Ensure all target states/zips are covered
3. **Rep Assignment** - Every active territory should have at least one rep
4. **Regular Audits** - Run alignment reports periodically
