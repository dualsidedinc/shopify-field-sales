import { prisma } from "@field-sales/database";

// US States for dropdown
export const US_STATES = [
  { code: "AL", name: "Alabama" },
  { code: "AK", name: "Alaska" },
  { code: "AZ", name: "Arizona" },
  { code: "AR", name: "Arkansas" },
  { code: "CA", name: "California" },
  { code: "CO", name: "Colorado" },
  { code: "CT", name: "Connecticut" },
  { code: "DE", name: "Delaware" },
  { code: "FL", name: "Florida" },
  { code: "GA", name: "Georgia" },
  { code: "HI", name: "Hawaii" },
  { code: "ID", name: "Idaho" },
  { code: "IL", name: "Illinois" },
  { code: "IN", name: "Indiana" },
  { code: "IA", name: "Iowa" },
  { code: "KS", name: "Kansas" },
  { code: "KY", name: "Kentucky" },
  { code: "LA", name: "Louisiana" },
  { code: "ME", name: "Maine" },
  { code: "MD", name: "Maryland" },
  { code: "MA", name: "Massachusetts" },
  { code: "MI", name: "Michigan" },
  { code: "MN", name: "Minnesota" },
  { code: "MS", name: "Mississippi" },
  { code: "MO", name: "Missouri" },
  { code: "MT", name: "Montana" },
  { code: "NE", name: "Nebraska" },
  { code: "NV", name: "Nevada" },
  { code: "NH", name: "New Hampshire" },
  { code: "NJ", name: "New Jersey" },
  { code: "NM", name: "New Mexico" },
  { code: "NY", name: "New York" },
  { code: "NC", name: "North Carolina" },
  { code: "ND", name: "North Dakota" },
  { code: "OH", name: "Ohio" },
  { code: "OK", name: "Oklahoma" },
  { code: "OR", name: "Oregon" },
  { code: "PA", name: "Pennsylvania" },
  { code: "RI", name: "Rhode Island" },
  { code: "SC", name: "South Carolina" },
  { code: "SD", name: "South Dakota" },
  { code: "TN", name: "Tennessee" },
  { code: "TX", name: "Texas" },
  { code: "UT", name: "Utah" },
  { code: "VT", name: "Vermont" },
  { code: "VA", name: "Virginia" },
  { code: "WA", name: "Washington" },
  { code: "WV", name: "West Virginia" },
  { code: "WI", name: "Wisconsin" },
  { code: "WY", name: "Wyoming" },
  { code: "DC", name: "District of Columbia" },
] as const;

// Types
export interface TerritoryListItem {
  id: string;
  name: string;
  code: string | null;
  description: string | null;
  isActive: boolean;
  stateCount: number;
  zipcodeCount: number;
  locationCount: number;
  repCount: number;
}

export interface TerritoryState {
  stateCode: string;
  stateName: string;
}

export interface TerritoryDetail {
  id: string;
  name: string;
  code: string | null;
  description: string | null;
  isActive: boolean;
  createdAt: string;
  states: TerritoryState[];
  zipcodes: string[];
  reps: AssignedRep[];
  locations: TerritoryLocation[];
  stateCodes: string[];
  repIds: string[];
}

export interface AssignedRep {
  id: string;
  name: string;
  isPrimary: boolean;
}

export interface TerritoryLocation {
  id: string;
  name: string;
  companyId: string;
  companyName: string;
  accountNumber: string | null;
}

export interface CreateTerritoryInput {
  shopId: string;
  name: string;
  code?: string | null;
  description?: string | null;
  stateCodes?: string[];
  zipcodes?: string[];
  repIds?: string[];
}

export interface UpdateTerritoryInput {
  name?: string;
  code?: string | null;
  description?: string | null;
  stateCodes?: string[];
  zipcodes?: string[];
  repIds?: string[];
}

// Queries
export async function getTerritories(shopId: string): Promise<TerritoryListItem[]> {
  const territories = await prisma.territory.findMany({
    where: { shopId },
    include: {
      states: { select: { id: true } },
      zipcodes: { select: { id: true } },
      locations: { select: { id: true } },
      repTerritories: { select: { id: true } },
    },
    orderBy: { name: "asc" },
  });

  return territories.map((t) => ({
    id: t.id,
    name: t.name,
    code: t.code,
    description: t.description,
    isActive: t.isActive,
    stateCount: t.states.length,
    zipcodeCount: t.zipcodes.length,
    locationCount: t.locations.length,
    repCount: t.repTerritories.length,
  }));
}

export async function getActiveTerritories(shopId: string) {
  const territories = await prisma.territory.findMany({
    where: { shopId, isActive: true },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  return territories;
}

export async function getTerritoryById(
  shopId: string,
  territoryId: string
): Promise<TerritoryDetail | null> {
  const territory = await prisma.territory.findFirst({
    where: { id: territoryId, shopId },
    include: {
      states: { orderBy: { stateName: "asc" } },
      zipcodes: { orderBy: { zipcode: "asc" } },
      repTerritories: {
        include: {
          rep: { select: { id: true, firstName: true, lastName: true } },
        },
        orderBy: { isPrimary: "desc" },
      },
      locations: {
        include: {
          company: {
            select: { id: true, name: true, accountNumber: true, isActive: true },
          },
        },
        orderBy: { name: "asc" },
      },
    },
  });

  if (!territory) return null;

  // Filter to only include locations from active companies
  const activeLocations = territory.locations.filter((l) => l.company.isActive);

  return {
    id: territory.id,
    name: territory.name,
    code: territory.code,
    description: territory.description,
    isActive: territory.isActive,
    createdAt: territory.createdAt.toISOString(),
    states: territory.states.map((s) => ({
      stateCode: s.stateCode,
      stateName: s.stateName,
    })),
    zipcodes: territory.zipcodes.map((z) => z.zipcode),
    reps: territory.repTerritories.map((rt) => ({
      id: rt.rep.id,
      name: `${rt.rep.firstName} ${rt.rep.lastName}`,
      isPrimary: rt.isPrimary,
    })),
    locations: activeLocations.map((l) => ({
      id: l.id,
      name: l.name,
      companyId: l.company.id,
      companyName: l.company.name,
      accountNumber: l.company.accountNumber,
    })),
    stateCodes: territory.states.map((s) => s.stateCode),
    repIds: territory.repTerritories.map((rt) => rt.repId),
  };
}

// Mutations
export async function createTerritory(
  input: CreateTerritoryInput
): Promise<{ success: true; territoryId: string } | { success: false; error: string }> {
  const { shopId, name, code, description, stateCodes, zipcodes, repIds } = input;

  if (!name?.trim()) {
    return { success: false, error: "Territory name is required" };
  }

  // Check for duplicate name
  const existing = await prisma.territory.findFirst({
    where: {
      shopId,
      name: { equals: name.trim(), mode: "insensitive" },
    },
  });

  if (existing) {
    return { success: false, error: "A territory with this name already exists" };
  }

  try {
    const territory = await prisma.territory.create({
      data: {
        shopId,
        name: name.trim(),
        code: code?.trim() || null,
        description: description?.trim() || null,
        isActive: true,
        ...(stateCodes && stateCodes.length > 0 && {
          states: {
            create: stateCodes.map((stateCode) => {
              const state = US_STATES.find((s) => s.code === stateCode);
              return {
                stateCode,
                stateName: state?.name || stateCode,
              };
            }),
          },
        }),
        ...(zipcodes && zipcodes.length > 0 && {
          zipcodes: {
            create: zipcodes.map((zipcode) => ({ zipcode })),
          },
        }),
        ...(repIds && repIds.length > 0 && {
          repTerritories: {
            create: repIds.map((repId, index) => ({
              repId,
              isPrimary: index === 0,
            })),
          },
        }),
      },
    });

    return { success: true, territoryId: territory.id };
  } catch (error) {
    console.error("Error creating territory:", error);
    return { success: false, error: "Failed to create territory" };
  }
}

export async function updateTerritory(
  shopId: string,
  territoryId: string,
  input: UpdateTerritoryInput
): Promise<{ success: true } | { success: false; error: string }> {
  const territory = await prisma.territory.findFirst({
    where: { id: territoryId, shopId },
  });

  if (!territory) {
    return { success: false, error: "Territory not found" };
  }

  const { name, code, description, stateCodes, zipcodes, repIds } = input;

  if (name !== undefined && !name?.trim()) {
    return { success: false, error: "Territory name is required" };
  }

  // Check for duplicate name (excluding current territory)
  if (name) {
    const existing = await prisma.territory.findFirst({
      where: {
        shopId,
        name: { equals: name.trim(), mode: "insensitive" },
        NOT: { id: territoryId },
      },
    });

    if (existing) {
      return { success: false, error: "A territory with this name already exists" };
    }
  }

  try {
    await prisma.$transaction(async (tx) => {
      // Update the territory
      await tx.territory.update({
        where: { id: territoryId },
        data: {
          ...(name && { name: name.trim() }),
          ...(code !== undefined && { code: code?.trim() || null }),
          ...(description !== undefined && { description: description?.trim() || null }),
        },
      });

      // Update states if provided
      if (stateCodes !== undefined) {
        // Delete existing states
        await tx.territoryState.deleteMany({
          where: { territoryId },
        });

        // Create new states
        if (stateCodes.length > 0) {
          await tx.territoryState.createMany({
            data: stateCodes.map((stateCode) => {
              const state = US_STATES.find((s) => s.code === stateCode);
              return {
                territoryId,
                stateCode,
                stateName: state?.name || stateCode,
              };
            }),
          });
        }
      }

      // Update zipcodes if provided
      if (zipcodes !== undefined) {
        // Delete existing zipcodes
        await tx.territoryZipcode.deleteMany({
          where: { territoryId },
        });

        // Create new zipcodes
        if (zipcodes.length > 0) {
          await tx.territoryZipcode.createMany({
            data: zipcodes.map((zipcode) => ({
              territoryId,
              zipcode,
            })),
          });
        }
      }

      // Update rep assignments if provided
      if (repIds !== undefined) {
        // Delete existing assignments
        await tx.repTerritory.deleteMany({
          where: { territoryId },
        });

        // Create new assignments
        if (repIds.length > 0) {
          await tx.repTerritory.createMany({
            data: repIds.map((repId, index) => ({
              territoryId,
              repId,
              isPrimary: index === 0,
            })),
          });
        }
      }
    });

    return { success: true };
  } catch (error) {
    console.error("Error updating territory:", error);
    return { success: false, error: "Failed to update territory" };
  }
}

/**
 * Update only the sales rep assignments for a territory.
 * This is a convenience function that wraps updateTerritory.
 */
export async function updateTerritoryReps(
  shopId: string,
  territoryId: string,
  repIds: string[]
): Promise<{ success: true } | { success: false; error: string }> {
  return updateTerritory(shopId, territoryId, { repIds });
}

export async function deactivateTerritory(
  shopId: string,
  territoryId: string
): Promise<{ success: true } | { success: false; error: string }> {
  const territory = await prisma.territory.findFirst({
    where: { id: territoryId, shopId },
  });

  if (!territory) {
    return { success: false, error: "Territory not found" };
  }

  try {
    await prisma.territory.update({
      where: { id: territoryId },
      data: { isActive: false },
    });

    return { success: true };
  } catch (error) {
    console.error("Error deactivating territory:", error);
    return { success: false, error: "Failed to deactivate territory" };
  }
}

export async function activateTerritory(
  shopId: string,
  territoryId: string
): Promise<{ success: true } | { success: false; error: string }> {
  const territory = await prisma.territory.findFirst({
    where: { id: territoryId, shopId },
  });

  if (!territory) {
    return { success: false, error: "Territory not found" };
  }

  try {
    await prisma.territory.update({
      where: { id: territoryId },
      data: { isActive: true },
    });

    return { success: true };
  } catch (error) {
    console.error("Error activating territory:", error);
    return { success: false, error: "Failed to activate territory" };
  }
}

/**
 * Permanently delete a territory. Only inactive territories can be deleted.
 */
export async function deleteTerritory(
  shopId: string,
  territoryId: string
): Promise<{ success: true } | { success: false; error: string }> {
  const territory = await prisma.territory.findFirst({
    where: { id: territoryId, shopId },
  });

  if (!territory) {
    return { success: false, error: "Territory not found" };
  }

  if (territory.isActive) {
    return { success: false, error: "Cannot delete an active territory. Deactivate it first." };
  }

  try {
    await prisma.$transaction(async (tx) => {
      // Delete related records first
      await tx.territoryState.deleteMany({ where: { territoryId } });
      await tx.territoryZipcode.deleteMany({ where: { territoryId } });
      await tx.repTerritory.deleteMany({ where: { territoryId } });

      // Clear territory from any locations
      await tx.companyLocation.updateMany({
        where: { territoryId },
        data: { territoryId: null },
      });

      // Delete the territory
      await tx.territory.delete({ where: { id: territoryId } });
    });

    return { success: true };
  } catch (error) {
    console.error("Error deleting territory:", error);
    return { success: false, error: "Failed to delete territory" };
  }
}

// Helper to parse ZIP codes from string input
export function parseZipcodes(zipcodesRaw: string | null): string[] {
  if (!zipcodesRaw) return [];
  return zipcodesRaw
    .split(",")
    .map((z) => z.trim())
    .filter((z) => z.length > 0);
}

// Alignment validation types
export interface TerritoryAlignmentReport {
  summary: {
    totalLocations: number;
    locationsWithTerritory: number;
    locationsWithoutTerritory: number;
    totalCompanies: number;
    companiesWithTerritoryLocations: number;
    companiesWithoutTerritoryLocations: number;
    totalTerritories: number;
    territoriesWithReps: number;
    territoriesWithoutReps: number;
  };
  unassignedLocations: Array<{
    id: string;
    name: string;
    companyId: string;
    companyName: string;
    zipcode: string | null;
    provinceCode: string | null;
  }>;
  companiesWithoutTerritories: Array<{
    id: string;
    name: string;
    locationCount: number;
  }>;
  territoriesWithoutReps: Array<{
    id: string;
    name: string;
    locationCount: number;
  }>;
}

/**
 * Generate a report on territory alignment status.
 * Shows locations without territories, companies without territory coverage,
 * and territories without assigned reps.
 */
export async function getTerritoryAlignmentReport(
  shopId: string
): Promise<TerritoryAlignmentReport> {
  // Get all locations with their territory and company info
  const locations = await prisma.companyLocation.findMany({
    where: {
      company: { shopId, isActive: true },
    },
    include: {
      company: { select: { id: true, name: true } },
      territory: { select: { id: true, name: true } },
    },
  });

  // Get all companies
  const companies = await prisma.company.findMany({
    where: { shopId, isActive: true },
    include: {
      locations: {
        select: { id: true, territoryId: true },
      },
    },
  });

  // Get all territories
  const territories = await prisma.territory.findMany({
    where: { shopId, isActive: true },
    include: {
      repTerritories: { select: { id: true } },
      locations: { select: { id: true } },
    },
  });

  // Calculate metrics
  const locationsWithTerritory = locations.filter((l) => l.territoryId !== null);
  const locationsWithoutTerritory = locations.filter((l) => l.territoryId === null);

  const companiesWithTerritoryLocations = companies.filter((c) =>
    c.locations.some((l) => l.territoryId !== null)
  );
  const companiesWithoutTerritoryLocations = companies.filter((c) =>
    c.locations.every((l) => l.territoryId === null)
  );

  const territoriesWithReps = territories.filter((t) => t.repTerritories.length > 0);
  const territoriesWithoutReps = territories.filter((t) => t.repTerritories.length === 0);

  return {
    summary: {
      totalLocations: locations.length,
      locationsWithTerritory: locationsWithTerritory.length,
      locationsWithoutTerritory: locationsWithoutTerritory.length,
      totalCompanies: companies.length,
      companiesWithTerritoryLocations: companiesWithTerritoryLocations.length,
      companiesWithoutTerritoryLocations: companiesWithoutTerritoryLocations.length,
      totalTerritories: territories.length,
      territoriesWithReps: territoriesWithReps.length,
      territoriesWithoutReps: territoriesWithoutReps.length,
    },
    unassignedLocations: locationsWithoutTerritory.map((l) => ({
      id: l.id,
      name: l.name,
      companyId: l.company.id,
      companyName: l.company.name,
      zipcode: l.zipcode,
      provinceCode: l.provinceCode,
    })),
    companiesWithoutTerritories: companiesWithoutTerritoryLocations.map((c) => ({
      id: c.id,
      name: c.name,
      locationCount: c.locations.length,
    })),
    territoriesWithoutReps: territoriesWithoutReps.map((t) => ({
      id: t.id,
      name: t.name,
      locationCount: t.locations.length,
    })),
  };
}

/**
 * Re-align all locations to territories based on their addresses.
 * Returns count of locations updated.
 */
export async function realignAllLocationsToTerritories(
  shopId: string
): Promise<{ updated: number; total: number }> {
  const locations = await prisma.companyLocation.findMany({
    where: {
      company: { shopId, isActive: true },
    },
    select: { id: true, zipcode: true, provinceCode: true },
  });

  let updated = 0;

  for (const location of locations) {
    const territoryId = await findTerritoryByLocation(
      shopId,
      location.zipcode,
      location.provinceCode
    );

    const result = await prisma.companyLocation.updateMany({
      where: { id: location.id },
      data: { territoryId },
    });

    if (result.count > 0) {
      updated++;
    }
  }

  return { updated, total: locations.length };
}

/**
 * Find a territory that matches the given location.
 * Priority: zipcode match (most specific) > state match
 * Returns the territory ID or null if no match found.
 */
export async function findTerritoryByLocation(
  shopId: string,
  zipcode: string | null | undefined,
  stateCode: string | null | undefined
): Promise<string | null> {
  // First, try to match by zipcode (most specific)
  if (zipcode) {
    const zipcodeMatch = await prisma.territoryZipcode.findFirst({
      where: {
        zipcode: zipcode.trim(),
        territory: {
          shopId,
          isActive: true,
        },
      },
      select: { territoryId: true },
    });

    if (zipcodeMatch) {
      console.log(`[Territory] Matched zipcode ${zipcode} to territory ${zipcodeMatch.territoryId}`);
      return zipcodeMatch.territoryId;
    }
  }

  // Fall back to state code match
  if (stateCode) {
    const stateMatch = await prisma.territoryState.findFirst({
      where: {
        stateCode: stateCode.trim().toUpperCase(),
        territory: {
          shopId,
          isActive: true,
        },
      },
      select: { territoryId: true },
    });

    if (stateMatch) {
      console.log(`[Territory] Matched state ${stateCode} to territory ${stateMatch.territoryId}`);
      return stateMatch.territoryId;
    }
  }

  console.log(`[Territory] No match found for zipcode=${zipcode}, state=${stateCode}`);
  return null;
}
