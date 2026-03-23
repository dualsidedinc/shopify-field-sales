import prisma from "../db.server";
import type { PaymentTerms } from "@prisma/client";
import { findTerritoryByLocation } from "./territory.server";
import { fromGid } from "../lib/shopify-ids";

// GraphQL query to fetch all companies with locations
const COMPANIES_QUERY = `#graphql
  query GetCompanies($first: Int!, $after: String) {
    companies(first: $first, after: $after) {
      pageInfo {
        hasNextPage
        endCursor
      }
      edges {
        node {
          id
          name
          externalId
          locations(first: 50) {
            edges {
              node {
                id
                name
                shippingAddress {
                  address1
                  address2
                  city
                  province
                  zoneCode
                  zip
                  country
                  countryCode
                  phone
                }
                billingAddress {
                  address1
                  address2
                  city
                  province
                  zoneCode
                  zip
                  country
                  countryCode
                  phone
                }
              }
            }
          }
          contacts(first: 50) {
            edges {
              node {
                id
                customer {
                  id
                  firstName
                  lastName
                  email
                  phone
                }
              }
            }
          }
        }
      }
    }
  }
`;

interface ShopifyGraphQLAddress {
  address1: string | null;
  address2: string | null;
  city: string | null;
  province: string | null;
  zoneCode: string | null;
  zip: string | null;
  country: string | null;
  countryCode: string | null;
  phone: string | null;
}

interface ShopifyGraphQLLocation {
  id: string;
  name: string;
  shippingAddress: ShopifyGraphQLAddress | null;
  billingAddress: ShopifyGraphQLAddress | null;
}

interface ShopifyGraphQLContact {
  id: string;
  customer: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    email: string | null;
    phone: string | null;
  } | null;
}

interface ShopifyGraphQLCompany {
  id: string;
  name: string;
  externalId: string | null;
  locations: {
    edges: Array<{ node: ShopifyGraphQLLocation }>;
  };
  contacts: {
    edges: Array<{ node: ShopifyGraphQLContact }>;
  };
}

interface CompaniesQueryResponse {
  data: {
    companies: {
      pageInfo: {
        hasNextPage: boolean;
        endCursor: string | null;
      };
      edges: Array<{ node: ShopifyGraphQLCompany }>;
    };
  };
}

export interface ImportResult {
  success: boolean;
  imported: number;
  updated: number;
  error?: string;
}

/**
 * Import all companies from Shopify Admin.
 * Fetches companies via GraphQL and upserts them into the database.
 */
export async function importCompaniesFromShopify(
  shopId: string,
  admin: { graphql: (query: string, options?: { variables: Record<string, unknown> }) => Promise<Response> }
): Promise<ImportResult> {
  let imported = 0;
  let updated = 0;
  let hasNextPage = true;
  let cursor: string | null = null;

  try {
    while (hasNextPage) {
      const response = await admin.graphql(COMPANIES_QUERY, {
        variables: { first: 50, after: cursor },
      });

      const result = (await response.json()) as CompaniesQueryResponse;
      const companies = result.data.companies;

      for (const { node: company } of companies.edges) {
        // Extract numeric ID from Shopify GID
        const shopifyCompanyId = fromGid(company.id);

        // Check if company already exists
        const existing = await prisma.company.findUnique({
          where: {
            shopId_shopifyCompanyId: {
              shopId,
              shopifyCompanyId,
            },
          },
        });

        // Upsert company
        const upsertedCompany = await prisma.company.upsert({
          where: {
            shopId_shopifyCompanyId: {
              shopId,
              shopifyCompanyId,
            },
          },
          create: {
            shopId,
            shopifyCompanyId,
            name: company.name,
            accountNumber: company.externalId || null,
            syncStatus: "SYNCED",
            lastSyncedAt: new Date(),
            isActive: true,
          },
          update: {
            name: company.name,
            accountNumber: company.externalId || undefined,
            syncStatus: "SYNCED",
            lastSyncedAt: new Date(),
            isActive: true,
          },
        });

        if (existing) {
          updated++;
        } else {
          imported++;
        }

        // Process locations
        for (const { node: location } of company.locations.edges) {
          const address = location.shippingAddress || location.billingAddress;
          const shopifyLocationId = fromGid(location.id);

          const upsertedLocation = await prisma.companyLocation.upsert({
            where: {
              companyId_shopifyLocationId: {
                companyId: upsertedCompany.id,
                shopifyLocationId,
              },
            },
            create: {
              companyId: upsertedCompany.id,
              shopifyLocationId,
              name: location.name,
              address1: address?.address1 || null,
              address2: address?.address2 || null,
              city: address?.city || null,
              province: address?.province || null,
              provinceCode: address?.zoneCode || null,
              zipcode: address?.zip || null,
              country: address?.country || "US",
              countryCode: address?.countryCode || "US",
              phone: address?.phone || null,
              isShippingAddress: !!location.shippingAddress,
              isBillingAddress: !!location.billingAddress,
              isPrimary: false,
            },
            update: {
              name: location.name,
              address1: address?.address1 || null,
              address2: address?.address2 || null,
              city: address?.city || null,
              province: address?.province || null,
              provinceCode: address?.zoneCode || null,
              zipcode: address?.zip || null,
              country: address?.country || "US",
              countryCode: address?.countryCode || "US",
              phone: address?.phone || null,
              isShippingAddress: !!location.shippingAddress,
              isBillingAddress: !!location.billingAddress,
            },
          });

          // Align location to territory
          await alignLocationToTerritory(shopId, upsertedLocation.id);
        }

        // Process contacts
        for (const { node: contact } of company.contacts.edges) {
          if (!contact.customer?.email) continue;

          const shopifyContactId = fromGid(contact.id);
          const shopifyCustomerId = fromGid(contact.customer.id);

          await prisma.companyContact.upsert({
            where: {
              companyId_email: {
                companyId: upsertedCompany.id,
                email: contact.customer.email,
              },
            },
            create: {
              companyId: upsertedCompany.id,
              shopifyContactId,
              shopifyCustomerId,
              firstName: contact.customer.firstName || "",
              lastName: contact.customer.lastName || "",
              email: contact.customer.email,
              phone: contact.customer.phone || null,
              isPrimary: false,
              canPlaceOrders: true,
            },
            update: {
              shopifyContactId,
              shopifyCustomerId,
              firstName: contact.customer.firstName || "",
              lastName: contact.customer.lastName || "",
              phone: contact.customer.phone || null,
            },
          });
        }
      }

      hasNextPage = companies.pageInfo.hasNextPage;
      cursor = companies.pageInfo.endCursor;
    }

    console.log(`[Import] Imported ${imported} new companies, updated ${updated} existing`);
    return { success: true, imported, updated };
  } catch (error) {
    console.error("[Import] Error importing companies:", error);
    return { success: false, imported, updated, error: String(error) };
  }
}

/**
 * Align a company location to a territory based on its address.
 * Called whenever a location is created or updated.
 */
export async function alignLocationToTerritory(
  shopId: string,
  locationId: string
): Promise<string | null> {
  const location = await prisma.companyLocation.findUnique({
    where: { id: locationId },
    select: { zipcode: true, provinceCode: true },
  });

  if (!location) {
    console.log(`[Territory] Location ${locationId} not found`);
    return null;
  }

  const territoryId = await findTerritoryByLocation(
    shopId,
    location.zipcode,
    location.provinceCode
  );

  // Update location's territory
  await prisma.companyLocation.update({
    where: { id: locationId },
    data: { territoryId },
  });

  console.log(`[Territory] Location ${locationId} aligned to territory ${territoryId || "none"}`);
  return territoryId;
}

// Types
export interface CompanyListItem {
  id: string;
  name: string;
  accountNumber: string | null;
  locationCount: number;
  contactCount: number;
  isActive: boolean;
  isShopifyManaged: boolean;
}

export interface CompanyDetail {
  id: string;
  name: string;
  accountNumber: string | null;
  paymentTerms: string;
  assignedRepId: string | null;
  assignedRepName: string | null;
  isActive: boolean;
  isShopifyManaged: boolean;
  shopifyCompanyId: string | null;
  locations: CompanyLocation[];
  contacts: CompanyContact[];
}

export interface CompanyLocation {
  id: string;
  name: string;
  address1: string | null;
  city: string | null;
  provinceCode: string | null;
  zipcode: string | null;
  isPrimary: boolean;
  territoryId: string | null;
  territoryName: string | null;
}

export interface CompanyContact {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  isPrimary: boolean;
  shopifyCustomerId: string | null;
}

export interface CreateCompanyInput {
  shopId: string;
  name: string;
  accountNumber?: string | null;
  paymentTerms?: PaymentTerms;
  assignedRepId?: string | null;
  location?: {
    name: string;
    address1?: string | null;
    city?: string | null;
    provinceCode?: string | null;
    zipcode?: string | null;
  } | null;
  contact?: {
    firstName: string;
    lastName: string;
    email: string;
    phone?: string | null;
  } | null;
}

export interface UpdateCompanyInput {
  name?: string;
  accountNumber?: string | null;
  paymentTerms?: PaymentTerms;
  assignedRepId?: string | null;
}

// Queries
export async function getCompanies(shopId: string): Promise<CompanyListItem[]> {
  const companies = await prisma.company.findMany({
    where: {
      shopId,
      isActive: true,
    },
    include: {
      locations: { select: { id: true } },
      contacts: { select: { id: true } },
    },
    orderBy: { name: "asc" },
  });

  return companies.map((c) => ({
    id: c.id,
    name: c.name,
    accountNumber: c.accountNumber,
    locationCount: c.locations.length,
    contactCount: c.contacts.length,
    isActive: c.isActive,
    isShopifyManaged: c.shopifyCompanyId !== null,
  }));
}

export async function getCompanyById(
  shopId: string,
  companyId: string
): Promise<CompanyDetail | null> {
  const company = await prisma.company.findFirst({
    where: {
      id: companyId,
      shopId,
    },
    include: {
      assignedRep: { select: { firstName: true, lastName: true } },
      locations: {
        include: {
          territory: { select: { name: true } },
        },
        orderBy: [{ isPrimary: "desc" }, { name: "asc" }],
      },
      contacts: {
        orderBy: [{ isPrimary: "desc" }, { lastName: "asc" }],
      },
    },
  });

  if (!company) return null;

  return {
    id: company.id,
    name: company.name,
    accountNumber: company.accountNumber,
    paymentTerms: company.paymentTerms,
    assignedRepId: company.assignedRepId,
    assignedRepName: company.assignedRep
      ? `${company.assignedRep.firstName} ${company.assignedRep.lastName}`
      : null,
    isActive: company.isActive,
    isShopifyManaged: company.shopifyCompanyId !== null,
    shopifyCompanyId: company.shopifyCompanyId,
    locations: company.locations.map((l) => ({
      id: l.id,
      name: l.name,
      address1: l.address1,
      city: l.city,
      provinceCode: l.provinceCode,
      zipcode: l.zipcode,
      isPrimary: l.isPrimary,
      territoryId: l.territoryId,
      territoryName: l.territory?.name || null,
    })),
    contacts: company.contacts.map((c) => ({
      id: c.id,
      firstName: c.firstName,
      lastName: c.lastName,
      email: c.email,
      phone: c.phone,
      isPrimary: c.isPrimary,
      shopifyCustomerId: c.shopifyCustomerId,
    })),
  };
}

// Mutations
export async function createCompany(
  input: CreateCompanyInput
): Promise<{ success: true; companyId: string } | { success: false; error: string }> {
  const { shopId, name, accountNumber, paymentTerms, assignedRepId, location, contact } = input;

  if (!name?.trim()) {
    return { success: false, error: "Company name is required" };
  }

  // Check for duplicate name
  const existing = await prisma.company.findFirst({
    where: {
      shopId,
      name: { equals: name.trim(), mode: "insensitive" },
    },
  });

  if (existing) {
    return { success: false, error: "A company with this name already exists" };
  }

  try {
    const company = await prisma.company.create({
      data: {
        shopId,
        name: name.trim(),
        accountNumber: accountNumber?.trim() || null,
        paymentTerms: paymentTerms || "DUE_ON_ORDER",
        assignedRepId: assignedRepId || null,
        syncStatus: "SYNCED",
        isActive: true,
        ...(location?.name?.trim() && {
          locations: {
            create: {
              name: location.name.trim(),
              isPrimary: true,
              address1: location.address1?.trim() || null,
              city: location.city?.trim() || null,
              provinceCode: location.provinceCode?.trim() || null,
              zipcode: location.zipcode?.trim() || null,
              country: "US",
              countryCode: "US",
            },
          },
        }),
        ...(contact?.firstName?.trim() && contact?.lastName?.trim() && contact?.email?.trim() && {
          contacts: {
            create: {
              firstName: contact.firstName.trim(),
              lastName: contact.lastName.trim(),
              email: contact.email.trim().toLowerCase(),
              phone: contact.phone?.trim() || null,
              isPrimary: true,
              canPlaceOrders: true,
            },
          },
        }),
      },
      include: {
        locations: { select: { id: true } },
      },
    });

    // Align location to territory based on address
    if (company.locations.length > 0) {
      await alignLocationToTerritory(shopId, company.locations[0].id);
    }

    return { success: true, companyId: company.id };
  } catch (error) {
    console.error("Error creating company:", error);
    return { success: false, error: "Failed to create company" };
  }
}

export async function updateCompany(
  shopId: string,
  companyId: string,
  input: UpdateCompanyInput
): Promise<{ success: true } | { success: false; error: string }> {
  const company = await prisma.company.findFirst({
    where: { id: companyId, shopId },
  });

  if (!company) {
    return { success: false, error: "Company not found" };
  }

  // For Shopify-managed companies, only allow rep assignment
  if (company.shopifyCompanyId !== null) {
    if (input.name !== undefined || input.accountNumber !== undefined || input.paymentTerms !== undefined) {
      return {
        success: false,
        error: "Shopify-managed companies can only have rep assignments updated",
      };
    }
  }

  if (input.name !== undefined && !input.name?.trim()) {
    return { success: false, error: "Company name is required" };
  }

  // Check for duplicate name (excluding current company)
  if (input.name) {
    const existing = await prisma.company.findFirst({
      where: {
        shopId,
        name: { equals: input.name.trim(), mode: "insensitive" },
        NOT: { id: companyId },
      },
    });

    if (existing) {
      return { success: false, error: "A company with this name already exists" };
    }
  }

  try {
    await prisma.company.update({
      where: { id: companyId },
      data: {
        ...(input.name && { name: input.name.trim() }),
        ...(input.accountNumber !== undefined && { accountNumber: input.accountNumber?.trim() || null }),
        ...(input.paymentTerms && { paymentTerms: input.paymentTerms }),
        ...(input.assignedRepId !== undefined && { assignedRepId: input.assignedRepId || null }),
      },
    });

    return { success: true };
  } catch (error) {
    console.error("Error updating company:", error);
    return { success: false, error: "Failed to update company" };
  }
}

export async function updateCompanyRepAssignment(
  shopId: string,
  companyId: string,
  assignedRepId: string | null
): Promise<{ success: true } | { success: false; error: string }> {
  const company = await prisma.company.findFirst({
    where: { id: companyId, shopId },
  });

  if (!company) {
    return { success: false, error: "Company not found" };
  }

  try {
    await prisma.company.update({
      where: { id: companyId },
      data: {
        assignedRepId: assignedRepId || null,
      },
    });

    return { success: true };
  } catch (error) {
    console.error("Error updating company rep assignment:", error);
    return { success: false, error: "Failed to update assignment" };
  }
}

export async function deactivateCompany(
  shopId: string,
  companyId: string
): Promise<{ success: true } | { success: false; error: string }> {
  const company = await prisma.company.findFirst({
    where: { id: companyId, shopId },
  });

  if (!company) {
    return { success: false, error: "Company not found" };
  }

  if (company.shopifyCompanyId !== null) {
    return { success: false, error: "Cannot deactivate Shopify-managed companies" };
  }

  try {
    await prisma.company.update({
      where: { id: companyId },
      data: { isActive: false },
    });

    return { success: true };
  } catch (error) {
    console.error("Error deactivating company:", error);
    return { success: false, error: "Failed to deactivate company" };
  }
}
