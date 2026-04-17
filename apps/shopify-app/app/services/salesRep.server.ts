import { prisma } from "@field-sales/database";
import type { RepRole } from "@prisma/client";

// Types
export interface SalesRepListItem {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  externalId: string | null;
  role: string;
  isActive: boolean;
  territoryCount: number;
  companyCount: number;
}

export interface SalesRepDetail {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  externalId: string | null;
  role: "REP" | "MANAGER" | "ADMIN";
  isActive: boolean;
  approvalThresholdCents: number | null;
  createdAt: string;
  territories: AssignedTerritory[];
  companies: AssignedCompany[];  // Directly assigned companies via assignedRepId
  territoryCompanies: Array<{ id: string; name: string; accountNumber: string | null; territories: string[] }>;  // Companies accessible via territories
  territoryIds: string[];
}

export interface AssignedTerritory {
  id: string;
  name: string;
  isPrimary: boolean;
  companyCount: number;
}

export interface AssignedCompany {
  id: string;
  name: string;
  territoryName: string | null;
}

export interface TerritoryCompany {
  id: string;
  name: string;
  accountNumber: string | null;
  locationId: string;
  locationName: string;
  territoryId: string;
  territoryName: string;
}

export interface CreateSalesRepInput {
  shopId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string | null;
  externalId?: string | null;
  role?: RepRole;
  territoryIds?: string[];
  approvalThresholdCents?: number | null;
}

export interface UpdateSalesRepInput {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string | null;
  externalId?: string | null;
  role?: RepRole;
  territoryIds?: string[];
  approvalThresholdCents?: number | null;
}

// Queries
export async function getSalesReps(shopId: string): Promise<SalesRepListItem[]> {
  const reps = await prisma.salesRep.findMany({
    where: { shopId },
    include: {
      repTerritories: { select: { id: true } },
      assignedCompanies: { select: { id: true } },
    },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
  });

  return reps.map((r) => ({
    id: r.id,
    firstName: r.firstName,
    lastName: r.lastName,
    email: r.email,
    phone: r.phone,
    externalId: r.externalId,
    role: r.role,
    isActive: r.isActive,
    territoryCount: r.repTerritories.length,
    companyCount: r.assignedCompanies.length,
  }));
}

export async function getActiveSalesReps(shopId: string) {
  const reps = await prisma.salesRep.findMany({
    where: { shopId, isActive: true },
    select: { id: true, firstName: true, lastName: true, email: true, role: true },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
  });

  return reps.map((r) => ({
    id: r.id,
    name: `${r.firstName} ${r.lastName}`,
    email: r.email,
    role: r.role,
  }));
}

export async function getSalesRepById(
  shopId: string,
  repId: string
): Promise<SalesRepDetail | null> {
  const rep = await prisma.salesRep.findFirst({
    where: { id: repId, shopId },
    include: {
      repTerritories: {
        include: {
          territory: {
            include: {
              locations: {
                where: { company: { isActive: true } },
                select: { id: true },
              },
            },
          },
        },
        orderBy: { isPrimary: "desc" },
      },
      assignedCompanies: {
        where: { isActive: true },
        include: {
          locations: {
            where: { isPrimary: true },
            include: { territory: { select: { name: true } } },
            take: 1,
          },
        },
        orderBy: { name: "asc" },
      },
    },
  });

  if (!rep) return null;

  // Get companies accessible via territories
  const territoryCompanies = await getUniqueCompaniesByRepTerritories(shopId, repId);

  return {
    id: rep.id,
    firstName: rep.firstName,
    lastName: rep.lastName,
    email: rep.email,
    phone: rep.phone,
    externalId: rep.externalId,
    role: rep.role,
    isActive: rep.isActive,
    approvalThresholdCents: rep.approvalThresholdCents,
    createdAt: rep.createdAt.toISOString(),
    territories: rep.repTerritories.map((rt) => ({
      id: rt.territory.id,
      name: rt.territory.name,
      isPrimary: rt.isPrimary,
      companyCount: rt.territory.locations.length,
    })),
    companies: rep.assignedCompanies.map((c) => ({
      id: c.id,
      name: c.name,
      territoryName: c.locations[0]?.territory?.name || null,
    })),
    territoryCompanies,
    territoryIds: rep.repTerritories.map((rt) => rt.territoryId),
  };
}

// Mutations
export async function createSalesRep(
  input: CreateSalesRepInput
): Promise<{ success: true; repId: string } | { success: false; error: string }> {
  const { shopId, firstName, lastName, email, phone, externalId, role, territoryIds, approvalThresholdCents } = input;

  if (!firstName?.trim() || !lastName?.trim() || !email?.trim()) {
    return { success: false, error: "First name, last name, and email are required" };
  }

  // Check for duplicate email
  const existingEmail = await prisma.salesRep.findFirst({
    where: {
      shopId,
      email: { equals: email.trim().toLowerCase(), mode: "insensitive" },
    },
  });

  if (existingEmail) {
    return { success: false, error: "A sales rep with this email already exists" };
  }

  // Check for duplicate phone (if provided)
  const normalizedPhone = phone?.replace(/\D/g, "");
  if (normalizedPhone) {
    const existingPhone = await prisma.salesRep.findFirst({
      where: {
        shopId,
        phone: normalizedPhone,
      },
    });

    if (existingPhone) {
      return { success: false, error: "A sales rep with this phone number already exists" };
    }
  }

  try {
    const rep = await prisma.salesRep.create({
      data: {
        shopId,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: email.trim().toLowerCase(),
        phone: normalizedPhone || null,
        externalId: externalId?.trim() || null,
        role: role || "REP",
        isActive: true,
        activatedAt: new Date(), // Track when rep was activated for billing
        // Default to 0 (all orders require approval) if not specified
        approvalThresholdCents: approvalThresholdCents ?? 0,
        ...(territoryIds && territoryIds.length > 0 && {
          repTerritories: {
            create: territoryIds.map((territoryId, index) => ({
              territoryId,
              isPrimary: index === 0,
            })),
          },
        }),
      },
    });

    return { success: true, repId: rep.id };
  } catch (error) {
    console.error("Error creating sales rep:", error);
    return { success: false, error: "Failed to create sales rep" };
  }
}

export async function updateSalesRep(
  shopId: string,
  repId: string,
  input: UpdateSalesRepInput
): Promise<{ success: true } | { success: false; error: string }> {
  const rep = await prisma.salesRep.findFirst({
    where: { id: repId, shopId },
  });

  if (!rep) {
    return { success: false, error: "Sales rep not found" };
  }

  const { firstName, lastName, email, phone, externalId, role, territoryIds, approvalThresholdCents } = input;

  if (
    (firstName !== undefined && !firstName?.trim()) ||
    (lastName !== undefined && !lastName?.trim()) ||
    (email !== undefined && !email?.trim())
  ) {
    return { success: false, error: "First name, last name, and email are required" };
  }

  // Check for duplicate email (excluding current rep)
  if (email) {
    const existingEmail = await prisma.salesRep.findFirst({
      where: {
        shopId,
        email: { equals: email.trim().toLowerCase(), mode: "insensitive" },
        NOT: { id: repId },
      },
    });

    if (existingEmail) {
      return { success: false, error: "A sales rep with this email already exists" };
    }
  }

  // Check for duplicate phone (excluding current rep)
  const normalizedPhone = phone?.replace(/\D/g, "");
  if (normalizedPhone) {
    const existingPhone = await prisma.salesRep.findFirst({
      where: {
        shopId,
        phone: normalizedPhone,
        NOT: { id: repId },
      },
    });

    if (existingPhone) {
      return { success: false, error: "A sales rep with this phone number already exists" };
    }
  }

  try {
    await prisma.$transaction(async (tx) => {
      // Update the sales rep
      await tx.salesRep.update({
        where: { id: repId },
        data: {
          ...(firstName && { firstName: firstName.trim() }),
          ...(lastName && { lastName: lastName.trim() }),
          ...(email && { email: email.trim().toLowerCase() }),
          ...(phone !== undefined && { phone: normalizedPhone || null }),
          ...(externalId !== undefined && { externalId: externalId?.trim() || null }),
          ...(role && { role }),
          ...(approvalThresholdCents !== undefined && { approvalThresholdCents }),
        },
      });

      // Update territory assignments if provided
      if (territoryIds !== undefined) {
        // Delete existing assignments
        await tx.repTerritory.deleteMany({
          where: { repId },
        });

        // Create new assignments
        if (territoryIds.length > 0) {
          await tx.repTerritory.createMany({
            data: territoryIds.map((territoryId, index) => ({
              repId,
              territoryId,
              isPrimary: index === 0,
            })),
          });
        }
      }
    });

    return { success: true };
  } catch (error) {
    console.error("Error updating sales rep:", error);
    return { success: false, error: "Failed to update sales rep" };
  }
}

export async function deactivateSalesRep(
  shopId: string,
  repId: string
): Promise<{ success: true } | { success: false; error: string }> {
  const rep = await prisma.salesRep.findFirst({
    where: { id: repId, shopId },
  });

  if (!rep) {
    return { success: false, error: "Sales rep not found" };
  }

  try {
    await prisma.salesRep.update({
      where: { id: repId },
      data: {
        isActive: false,
        deactivatedAt: new Date(), // Track for billing
      },
    });

    return { success: true };
  } catch (error) {
    console.error("Error deactivating sales rep:", error);
    return { success: false, error: "Failed to deactivate sales rep" };
  }
}

export async function activateSalesRep(
  shopId: string,
  repId: string
): Promise<{ success: true } | { success: false; error: string }> {
  const rep = await prisma.salesRep.findFirst({
    where: { id: repId, shopId },
  });

  if (!rep) {
    return { success: false, error: "Sales rep not found" };
  }

  try {
    await prisma.salesRep.update({
      where: { id: repId },
      data: {
        isActive: true,
        activatedAt: new Date(), // Track for billing (each activation starts a new billing period for this rep)
        deactivatedAt: null, // Clear deactivation
      },
    });

    return { success: true };
  } catch (error) {
    console.error("Error activating sales rep:", error);
    return { success: false, error: "Failed to activate sales rep" };
  }
}

/**
 * Get all companies a sales rep has access to through their territory assignments.
 * A rep can access a company if any of the company's locations are in one of the rep's territories.
 */
export async function getCompaniesByRepTerritories(
  shopId: string,
  repId: string
): Promise<TerritoryCompany[]> {
  // Get all territory IDs for this rep
  const repTerritories = await prisma.repTerritory.findMany({
    where: { repId },
    select: { territoryId: true },
  });

  const territoryIds = repTerritories.map((rt) => rt.territoryId);

  if (territoryIds.length === 0) {
    return [];
  }

  // Find all locations in these territories, with their companies
  const locations = await prisma.companyLocation.findMany({
    where: {
      territoryId: { in: territoryIds },
      company: {
        shopId,
        isActive: true,
      },
    },
    include: {
      company: {
        select: { id: true, name: true, accountNumber: true },
      },
      territory: {
        select: { id: true, name: true },
      },
    },
    orderBy: [
      { company: { name: "asc" } },
      { name: "asc" },
    ],
  });

  return locations.map((loc) => ({
    id: loc.company.id,
    name: loc.company.name,
    accountNumber: loc.company.accountNumber,
    locationId: loc.id,
    locationName: loc.name,
    territoryId: loc.territory!.id,
    territoryName: loc.territory!.name,
  }));
}

/**
 * Get unique companies a sales rep has access to through territories.
 * Returns distinct companies (not per-location).
 */
export async function getUniqueCompaniesByRepTerritories(
  shopId: string,
  repId: string
): Promise<Array<{ id: string; name: string; accountNumber: string | null; territories: string[] }>> {
  const territoryCompanies = await getCompaniesByRepTerritories(shopId, repId);

  // Group by company ID
  const companyMap = new Map<string, {
    id: string;
    name: string;
    accountNumber: string | null;
    territories: Set<string>;
  }>();

  for (const tc of territoryCompanies) {
    const existing = companyMap.get(tc.id);
    if (existing) {
      existing.territories.add(tc.territoryName);
    } else {
      companyMap.set(tc.id, {
        id: tc.id,
        name: tc.name,
        accountNumber: tc.accountNumber,
        territories: new Set([tc.territoryName]),
      });
    }
  }

  return Array.from(companyMap.values()).map((c) => ({
    ...c,
    territories: Array.from(c.territories),
  }));
}
