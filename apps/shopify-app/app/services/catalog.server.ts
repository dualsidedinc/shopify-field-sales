/**
 * Catalog Sync Service
 *
 * Handles syncing B2B catalogs and price lists from Shopify.
 * Catalogs are assigned to CompanyLocations and contain pricing overrides for variants.
 */

import prisma from "../db.server";
import { fromGid } from "../lib/shopify-ids";

// Shopify Admin API interface
interface ShopifyAdmin {
  graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response>;
}

// ============================================
// GRAPHQL QUERIES
// ============================================

// Query catalogs assigned to a company location
const COMPANY_LOCATION_CATALOGS_QUERY = `#graphql
  query CompanyLocationCatalogs($id: ID!) {
    companyLocation(id: $id) {
      id
      catalogs(first: 10) {
        nodes {
          id
          title
          status
          priceList {
            id
            name
            currency
          }
        }
      }
    }
  }
`;

// Query price list prices with pagination (includes volume pricing)
const PRICE_LIST_PRICES_QUERY = `#graphql
  query PriceListPrices($id: ID!, $first: Int!, $after: String) {
    priceList(id: $id) {
      id
      prices(first: $first, after: $after) {
        pageInfo {
          hasNextPage
          endCursor
        }
        nodes {
          variant {
            id
            product {
              id
            }
          }
          price {
            amount
            currencyCode
          }
          compareAtPrice {
            amount
          }
          quantityPriceBreaks(first: 10) {
            nodes {
              minimumQuantity
              price {
                amount
              }
            }
          }
        }
      }
    }
  }
`;

// Query quantity rules for a price list
const PRICE_LIST_QUANTITY_RULES_QUERY = `#graphql
  query PriceListQuantityRules($id: ID!, $first: Int!, $after: String) {
    priceList(id: $id) {
      id
      quantityRules(first: $first, after: $after, originType: FIXED) {
        pageInfo {
          hasNextPage
          endCursor
        }
        nodes {
          increment
          minimum
          maximum
          productVariant {
            id
          }
        }
      }
    }
  }
`;

// Query a single catalog by ID
const CATALOG_QUERY = `#graphql
  query Catalog($id: ID!) {
    catalog(id: $id) {
      id
      title
      status
      priceList {
        id
        name
        currency
      }
    }
  }
`;

// Query all B2B catalogs for a shop (CompanyLocationCatalog type)
const SHOP_CATALOGS_QUERY = `#graphql
  query ShopCatalogs($first: Int!, $after: String) {
    catalogs(first: $first, after: $after, type: COMPANY_LOCATION) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        id
        title
        status
        priceList {
          id
          name
          currency
        }
      }
    }
  }
`;

// ============================================
// TYPES
// ============================================

interface ShopifyCatalog {
  id: string;
  title: string;
  status: string;
  priceList?: {
    id: string;
    name: string;
    currency: string;
  } | null;
}

interface ShopifyPriceListPrice {
  variant: {
    id: string;
    product: {
      id: string;
    };
  };
  price: {
    amount: string;
    currencyCode: string;
  };
  compareAtPrice?: {
    amount: string;
  } | null;
  quantityPriceBreaks?: {
    nodes: Array<{
      minimumQuantity: number;
      price: {
        amount: string;
      };
    }>;
  };
}

interface ShopifyQuantityRule {
  increment: number;
  minimum: number;
  maximum: number | null;
  productVariant: {
    id: string;
  };
}

// ============================================
// SYNC FUNCTIONS
// ============================================

/**
 * Sync all catalogs assigned to a company location
 */
export async function syncCompanyLocationCatalogs(
  shopId: string,
  companyLocationId: string,
  shopifyLocationId: string,
  admin: ShopifyAdmin
): Promise<{ success: true; catalogCount: number } | { success: false; error: string }> {
  try {
    console.log(`[Catalog Sync] Syncing catalogs for location ${shopifyLocationId}`);

    // Fetch catalogs from Shopify
    const response = await admin.graphql(COMPANY_LOCATION_CATALOGS_QUERY, {
      variables: { id: `gid://shopify/CompanyLocation/${shopifyLocationId}` },
    });

    const result: {
      data?: {
        companyLocation?: {
          catalogs: {
            nodes: ShopifyCatalog[];
          };
        };
      };
    } = await response.json();

    const catalogs = result.data?.companyLocation?.catalogs?.nodes || [];
    console.log(`[Catalog Sync] Found ${catalogs.length} catalogs for location`);

    // Process each catalog
    const catalogIds: string[] = [];
    for (const shopifyCatalog of catalogs) {
      const catalog = await syncCatalog(shopId, shopifyCatalog, admin);
      if (catalog) {
        catalogIds.push(catalog.id);
      }
    }

    // Update location-catalog assignments
    // First, remove old assignments
    await prisma.companyLocationCatalog.deleteMany({
      where: { companyLocationId },
    });

    // Then create new assignments
    if (catalogIds.length > 0) {
      await prisma.companyLocationCatalog.createMany({
        data: catalogIds.map((catalogId) => ({
          companyLocationId,
          catalogId,
        })),
        skipDuplicates: true,
      });
    }

    console.log(`[Catalog Sync] Assigned ${catalogIds.length} catalogs to location`);
    return { success: true, catalogCount: catalogIds.length };
  } catch (error) {
    console.error("[Catalog Sync] Error syncing location catalogs:", error);
    return { success: false, error: String(error) };
  }
}

/**
 * Sync a single catalog and its price list items
 */
export async function syncCatalog(
  shopId: string,
  shopifyCatalog: ShopifyCatalog,
  admin: ShopifyAdmin
): Promise<{ id: string } | null> {
  try {
    const shopifyCatalogId = fromGid(shopifyCatalog.id);
    const shopifyPriceListId = shopifyCatalog.priceList
      ? fromGid(shopifyCatalog.priceList.id)
      : null;

    console.log(`[Catalog Sync] Syncing catalog ${shopifyCatalog.title} (${shopifyCatalogId})`);

    // Map Shopify status to our enum
    const status = mapCatalogStatus(shopifyCatalog.status);

    // Upsert the catalog
    const catalog = await prisma.catalog.upsert({
      where: {
        shopId_shopifyCatalogId: {
          shopId,
          shopifyCatalogId,
        },
      },
      create: {
        shopId,
        shopifyCatalogId,
        shopifyPriceListId,
        title: shopifyCatalog.title,
        status,
        currencyCode: shopifyCatalog.priceList?.currency || "USD",
        syncedAt: new Date(),
      },
      update: {
        shopifyPriceListId,
        title: shopifyCatalog.title,
        status,
        currencyCode: shopifyCatalog.priceList?.currency || "USD",
        syncedAt: new Date(),
      },
    });

    // Sync price list items if there's a price list
    if (shopifyCatalog.priceList) {
      await syncPriceListItems(catalog.id, shopifyCatalog.priceList.id, admin);
    }

    return { id: catalog.id };
  } catch (error) {
    console.error(`[Catalog Sync] Error syncing catalog:`, error);
    return null;
  }
}

/**
 * Sync all prices, quantity rules, and volume pricing from a price list
 */
async function syncPriceListItems(
  catalogId: string,
  priceListGid: string,
  admin: ShopifyAdmin
): Promise<void> {
  console.log(`[Catalog Sync] Syncing price list items for catalog ${catalogId}`);

  // Step 1: Fetch all prices with quantity price breaks
  let hasNextPage = true;
  let cursor: string | null = null;
  let totalItems = 0;

  const allItems: {
    shopifyVariantId: string;
    shopifyProductId: string;
    priceCents: number;
    compareAtPriceCents: number | null;
    priceBreaks: Array<{ minimumQuantity: number; priceCents: number }>;
  }[] = [];

  while (hasNextPage) {
    const response = await admin.graphql(PRICE_LIST_PRICES_QUERY, {
      variables: {
        id: priceListGid,
        first: 250,
        after: cursor,
      },
    });

    const result: {
      data?: {
        priceList?: {
          prices: {
            pageInfo: {
              hasNextPage: boolean;
              endCursor: string | null;
            };
            nodes: ShopifyPriceListPrice[];
          };
        };
      };
    } = await response.json();

    const prices = result.data?.priceList?.prices;
    if (!prices) break;

    for (const price of prices.nodes) {
      const priceBreaks = (price.quantityPriceBreaks?.nodes || []).map((pb) => ({
        minimumQuantity: pb.minimumQuantity,
        priceCents: Math.round(parseFloat(pb.price.amount) * 100),
      }));

      allItems.push({
        shopifyVariantId: fromGid(price.variant.id),
        shopifyProductId: fromGid(price.variant.product.id),
        priceCents: Math.round(parseFloat(price.price.amount) * 100),
        compareAtPriceCents: price.compareAtPrice
          ? Math.round(parseFloat(price.compareAtPrice.amount) * 100)
          : null,
        priceBreaks,
      });
    }

    hasNextPage = prices.pageInfo.hasNextPage;
    cursor = prices.pageInfo.endCursor;
    totalItems += prices.nodes.length;
  }

  console.log(`[Catalog Sync] Fetched ${totalItems} price list items`);

  // Step 2: Fetch quantity rules (min/max/increment)
  const quantityRules = new Map<string, { min: number; max: number | null; increment: number }>();
  hasNextPage = true;
  cursor = null;

  while (hasNextPage) {
    const response = await admin.graphql(PRICE_LIST_QUANTITY_RULES_QUERY, {
      variables: {
        id: priceListGid,
        first: 250,
        after: cursor,
      },
    });

    const result: {
      data?: {
        priceList?: {
          quantityRules: {
            pageInfo: {
              hasNextPage: boolean;
              endCursor: string | null;
            };
            nodes: ShopifyQuantityRule[];
          };
        };
      };
    } = await response.json();

    const rules = result.data?.priceList?.quantityRules;
    if (!rules) break;

    for (const rule of rules.nodes) {
      const variantId = fromGid(rule.productVariant.id);
      quantityRules.set(variantId, {
        min: rule.minimum,
        max: rule.maximum,
        increment: rule.increment,
      });
    }

    hasNextPage = rules.pageInfo.hasNextPage;
    cursor = rules.pageInfo.endCursor;
  }

  console.log(`[Catalog Sync] Fetched ${quantityRules.size} quantity rules`);

  // Step 3: Delete existing items and insert new ones in a transaction
  await prisma.$transaction(async (tx) => {
    // Delete all existing items for this catalog (cascades to price breaks)
    await tx.catalogItem.deleteMany({
      where: { catalogId },
    });

    // Insert all items with quantity rules
    for (const item of allItems) {
      const rule = quantityRules.get(item.shopifyVariantId);

      const catalogItem = await tx.catalogItem.create({
        data: {
          catalogId,
          shopifyVariantId: item.shopifyVariantId,
          shopifyProductId: item.shopifyProductId,
          priceCents: item.priceCents,
          compareAtPriceCents: item.compareAtPriceCents,
          quantityMin: rule?.min || null,
          quantityMax: rule?.max || null,
          quantityIncrement: rule?.increment || null,
        },
      });

      // Insert price breaks if any
      if (item.priceBreaks.length > 0) {
        await tx.catalogItemPriceBreak.createMany({
          data: item.priceBreaks.map((pb) => ({
            catalogItemId: catalogItem.id,
            minimumQuantity: pb.minimumQuantity,
            priceCents: pb.priceCents,
          })),
        });
      }
    }
  });

  const totalPriceBreaks = allItems.reduce((sum, item) => sum + item.priceBreaks.length, 0);
  console.log(`[Catalog Sync] Synced ${allItems.length} catalog items with ${quantityRules.size} quantity rules and ${totalPriceBreaks} price breaks`);
}

/**
 * Sync all B2B catalogs for a shop
 */
export async function syncAllShopCatalogs(
  shopId: string,
  admin: ShopifyAdmin
): Promise<{ success: true; catalogCount: number } | { success: false; error: string }> {
  try {
    console.log(`[Catalog Sync] Syncing all catalogs for shop ${shopId}`);

    let hasNextPage = true;
    let cursor: string | null = null;
    let catalogCount = 0;

    while (hasNextPage) {
      const response = await admin.graphql(SHOP_CATALOGS_QUERY, {
        variables: {
          first: 50,
          after: cursor,
        },
      });

      const result: {
        data?: {
          catalogs: {
            pageInfo: {
              hasNextPage: boolean;
              endCursor: string | null;
            };
            nodes: ShopifyCatalog[];
          };
        };
      } = await response.json();

      const catalogs = result.data?.catalogs;
      if (!catalogs) break;

      for (const shopifyCatalog of catalogs.nodes) {
        await syncCatalog(shopId, shopifyCatalog, admin);
        catalogCount++;
      }

      hasNextPage = catalogs.pageInfo.hasNextPage;
      cursor = catalogs.pageInfo.endCursor;
    }

    console.log(`[Catalog Sync] Synced ${catalogCount} catalogs`);
    return { success: true, catalogCount };
  } catch (error) {
    console.error("[Catalog Sync] Error syncing shop catalogs:", error);
    return { success: false, error: String(error) };
  }
}

export interface CatalogPricing {
  priceCents: number;
  compareAtPriceCents: number | null;
  quantityMin: number | null;
  quantityMax: number | null;
  quantityIncrement: number | null;
  priceBreaks: Array<{ minimumQuantity: number; priceCents: number }>;
}

/**
 * Get catalog pricing for a company location
 * Includes pricing, quantity rules, and volume pricing
 */
export async function getCatalogPricingForLocation(
  companyLocationId: string
): Promise<Map<string, CatalogPricing>> {
  // Get all catalog items for catalogs assigned to this location
  const catalogItems = await prisma.catalogItem.findMany({
    where: {
      catalog: {
        status: "ACTIVE",
        locations: {
          some: { companyLocationId },
        },
      },
    },
    select: {
      shopifyVariantId: true,
      priceCents: true,
      compareAtPriceCents: true,
      quantityMin: true,
      quantityMax: true,
      quantityIncrement: true,
      priceBreaks: {
        select: {
          minimumQuantity: true,
          priceCents: true,
        },
        orderBy: {
          minimumQuantity: "asc",
        },
      },
    },
  });

  // Build a map of variant ID -> pricing with rules
  const pricingMap = new Map<string, CatalogPricing>();
  for (const item of catalogItems) {
    pricingMap.set(item.shopifyVariantId, {
      priceCents: item.priceCents,
      compareAtPriceCents: item.compareAtPriceCents,
      quantityMin: item.quantityMin,
      quantityMax: item.quantityMax,
      quantityIncrement: item.quantityIncrement,
      priceBreaks: item.priceBreaks,
    });
  }

  return pricingMap;
}

/**
 * Check if a variant is available in any catalog for a location
 */
export async function getAvailableVariantsForLocation(
  companyLocationId: string
): Promise<Set<string>> {
  const catalogItems = await prisma.catalogItem.findMany({
    where: {
      catalog: {
        status: "ACTIVE",
        locations: {
          some: { companyLocationId },
        },
      },
    },
    select: {
      shopifyVariantId: true,
    },
  });

  return new Set(catalogItems.map((item) => item.shopifyVariantId));
}

/**
 * Delete a catalog and all its items
 */
export async function deleteCatalog(
  shopId: string,
  shopifyCatalogId: string
): Promise<{ success: boolean }> {
  try {
    await prisma.catalog.delete({
      where: {
        shopId_shopifyCatalogId: {
          shopId,
          shopifyCatalogId,
        },
      },
    });
    return { success: true };
  } catch (error) {
    console.error("[Catalog Sync] Error deleting catalog:", error);
    return { success: false };
  }
}

// ============================================
// HELPERS
// ============================================

function mapCatalogStatus(shopifyStatus: string): "ACTIVE" | "DRAFT" | "ARCHIVED" {
  switch (shopifyStatus.toUpperCase()) {
    case "ACTIVE":
      return "ACTIVE";
    case "DRAFT":
      return "DRAFT";
    case "ARCHIVED":
      return "ARCHIVED";
    default:
      return "DRAFT";
  }
}
