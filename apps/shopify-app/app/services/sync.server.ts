/**
 * Unified Sync Service
 *
 * Provides comprehensive sync functionality for reconciling data between
 * Shopify and the local database. Can be triggered via:
 * - GitHub Actions API call (nightly)
 * - Sync button in admin UI
 * - Order validation process
 */

import { prisma } from "@field-sales/database";
import { unauthenticated } from "../shopify.server";
import { toGid, fromGid } from "../lib/shopify-ids";
import { syncCompanyDetails } from "./companySync.server";
import { syncAllShopCatalogs } from "./catalog.server";

// ============================================
// TYPES
// ============================================

export type SyncObjectType = "companies" | "products" | "catalogs" | "all";

export interface SyncOptions {
  /** Which object types to sync */
  objects?: SyncObjectType | SyncObjectType[];
  /** Force full sync even if recently synced */
  force?: boolean;
}

export interface SyncResult {
  success: boolean;
  duration: number; // milliseconds
  results: {
    companies?: { synced: number; deleted: number; errors: number };
    products?: { synced: number; deleted: number; errors: number };
    catalogs?: { synced: number; errors: number };
  };
  errors: string[];
}

export interface ShopSyncResult extends SyncResult {
  shopId: string;
  shopDomain: string;
}

export interface AllShopsSyncResult {
  success: boolean;
  duration: number;
  shopsProcessed: number;
  shopResults: ShopSyncResult[];
  errors: string[];
}

// ============================================
// GRAPHQL QUERIES
// ============================================

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
        }
      }
    }
  }
`;

const PRODUCTS_QUERY = `#graphql
  query GetProducts($first: Int!, $after: String) {
    products(first: $first, after: $after) {
      pageInfo {
        hasNextPage
        endCursor
      }
      edges {
        node {
          id
          title
          descriptionHtml
          vendor
          productType
          status
          tags
          featuredImage {
            url
          }
          variants(first: 100) {
            edges {
              node {
                id
                title
                sku
                price
                compareAtPrice
                inventoryQuantity
                position
              }
            }
          }
        }
      }
    }
  }
`;

// ============================================
// MAIN SYNC FUNCTIONS
// ============================================

/**
 * Sync a single shop with specified object types
 */
export async function syncShop(
  shopId: string,
  options: SyncOptions = {}
): Promise<SyncResult> {
  const startTime = Date.now();
  const errors: string[] = [];
  const results: SyncResult["results"] = {};

  const objectsToSync = normalizeObjectTypes(options.objects);

  try {
    const shop = await prisma.shop.findUnique({
      where: { id: shopId },
      select: { id: true, shopifyDomain: true, productInclusionTag: true, accessToken: true },
    });

    if (!shop) {
      return {
        success: false,
        duration: Date.now() - startTime,
        results,
        errors: ["Shop not found"],
      };
    }

    if (!shop.accessToken) {
      console.log(`[Sync] Shop ${shop.shopifyDomain} has no access token, skipping`);
      return {
        success: false,
        duration: Date.now() - startTime,
        results,
        errors: ["Shop has no access token - app may not be installed"],
      };
    }

    console.log(`[Sync] Starting sync for shop ${shop.shopifyDomain}`, { objects: objectsToSync });

    // Get admin client for this shop
    let admin;
    try {
      const result = await unauthenticated.admin(shop.shopifyDomain);
      admin = result.admin;
    } catch (authError) {
      let authErrorMsg = "Authentication failed";
      if (authError instanceof Error) {
        authErrorMsg = authError.message;
      } else if (authError instanceof Response) {
        authErrorMsg = `HTTP ${authError.status}: ${authError.statusText}`;
      }
      console.error(`[Sync] Failed to authenticate with Shopify for ${shop.shopifyDomain}:`, authErrorMsg);
      return {
        success: false,
        duration: Date.now() - startTime,
        results,
        errors: [`Authentication failed: ${authErrorMsg}`],
      };
    }

    // Sync companies (includes contacts and locations)
    if (objectsToSync.includes("companies") || objectsToSync.includes("all")) {
      try {
        const companyResult = await syncCompaniesForShop(shop.id, shop.shopifyDomain, admin);
        results.companies = companyResult;
        console.log(`[Sync] Companies: ${companyResult.synced} synced, ${companyResult.deleted} deleted`);
      } catch (error) {
        const errorMsg = `Companies sync failed: ${error}`;
        console.error(`[Sync] ${errorMsg}`);
        errors.push(errorMsg);
        results.companies = { synced: 0, deleted: 0, errors: 1 };
      }
    }

    // Sync products
    if (objectsToSync.includes("products") || objectsToSync.includes("all")) {
      try {
        const productResult = await syncProductsForShop(shop.id, shop.productInclusionTag, admin);
        results.products = productResult;
        console.log(`[Sync] Products: ${productResult.synced} synced, ${productResult.deleted} deleted`);
      } catch (error) {
        const errorMsg = `Products sync failed: ${error}`;
        console.error(`[Sync] ${errorMsg}`);
        errors.push(errorMsg);
        results.products = { synced: 0, deleted: 0, errors: 1 };
      }
    }

    // Sync catalogs
    if (objectsToSync.includes("catalogs") || objectsToSync.includes("all")) {
      try {
        const catalogResult = await syncAllShopCatalogs(shop.id, admin);
        if (catalogResult.success) {
          results.catalogs = { synced: catalogResult.catalogCount, errors: 0 };
          console.log(`[Sync] Catalogs: ${catalogResult.catalogCount} synced`);
        } else {
          throw new Error(catalogResult.error);
        }
      } catch (error) {
        const errorMsg = `Catalogs sync failed: ${error}`;
        console.error(`[Sync] ${errorMsg}`);
        errors.push(errorMsg);
        results.catalogs = { synced: 0, errors: 1 };
      }
    }

    const duration = Date.now() - startTime;
    console.log(`[Sync] Completed sync for ${shop.shopifyDomain} in ${duration}ms`);

    return {
      success: errors.length === 0,
      duration,
      results,
      errors,
    };
  } catch (error) {
    console.error(`[Sync] Fatal error syncing shop ${shopId}:`, error);

    // Extract useful error message
    let errorMessage = "Unknown error";
    if (error instanceof Error) {
      errorMessage = error.message;
    } else if (error instanceof Response) {
      errorMessage = `HTTP ${error.status}: ${error.statusText}`;
    } else if (typeof error === "string") {
      errorMessage = error;
    } else {
      errorMessage = String(error);
    }

    return {
      success: false,
      duration: Date.now() - startTime,
      results,
      errors: [`Fatal error: ${errorMessage}`],
    };
  }
}

/**
 * Sync all active shops
 * Used for nightly reconciliation via GitHub Actions
 */
export async function syncAllShops(
  options: SyncOptions = {}
): Promise<AllShopsSyncResult> {
  const startTime = Date.now();
  const errors: string[] = [];
  const shopResults: ShopSyncResult[] = [];

  try {
    // Get all active shops with valid access tokens
    const shops = await prisma.shop.findMany({
      where: {
        isActive: true,
        // Only sync shops that have completed installation
        accessToken: { not: "" },
      },
      select: { id: true, shopifyDomain: true },
    });

    console.log(`[Sync] Starting sync for ${shops.length} shops`);

    // Process shops sequentially to avoid rate limiting
    for (const shop of shops) {
      try {
        console.log(`[Sync] Processing shop: ${shop.shopifyDomain}`);
        const result = await syncShop(shop.id, options);
        shopResults.push({
          ...result,
          shopId: shop.id,
          shopDomain: shop.shopifyDomain,
        });
      } catch (error) {
        const errorMsg = `Shop ${shop.shopifyDomain} sync failed: ${error}`;
        console.error(`[Sync] ${errorMsg}`);
        errors.push(errorMsg);
        shopResults.push({
          success: false,
          duration: 0,
          results: {},
          errors: [errorMsg],
          shopId: shop.id,
          shopDomain: shop.shopifyDomain,
        });
      }
    }

    const duration = Date.now() - startTime;
    const successCount = shopResults.filter((r) => r.success).length;

    console.log(`[Sync] All shops sync completed in ${duration}ms: ${successCount}/${shops.length} successful`);

    return {
      success: errors.length === 0 && shopResults.every((r) => r.success),
      duration,
      shopsProcessed: shops.length,
      shopResults,
      errors,
    };
  } catch (error) {
    console.error("[Sync] Fatal error syncing all shops:", error);
    return {
      success: false,
      duration: Date.now() - startTime,
      shopsProcessed: 0,
      shopResults,
      errors: [`Fatal error: ${error}`],
    };
  }
}

// ============================================
// OBJECT-SPECIFIC SYNC FUNCTIONS
// ============================================

/**
 * Sync all companies for a shop
 * Fetches company list from Shopify, then syncs each company's full details
 */
async function syncCompaniesForShop(
  shopId: string,
  shopDomain: string,
  admin: { graphql: (query: string, options?: { variables: Record<string, unknown> }) => Promise<Response> }
): Promise<{ synced: number; deleted: number; errors: number }> {
  let hasNextPage = true;
  let cursor: string | null = null;
  let synced = 0;
  let errorCount = 0;
  const shopifyCompanyIds = new Set<string>();

  // Fetch all company IDs from Shopify
  while (hasNextPage) {
    const response = await admin.graphql(COMPANIES_QUERY, {
      variables: { first: 50, after: cursor },
    });

    const result = await response.json() as {
      data?: {
        companies: {
          pageInfo: { hasNextPage: boolean; endCursor: string | null };
          edges: Array<{ node: { id: string; name: string; externalId: string | null } }>;
        };
      };
    };

    const companies = result.data?.companies;
    if (!companies) break;

    for (const edge of companies.edges) {
      const shopifyCompanyId = fromGid(edge.node.id);
      shopifyCompanyIds.add(shopifyCompanyId);

      // Sync full company details (contacts, locations, payment methods)
      const syncResult = await syncCompanyDetails(shopDomain, shopifyCompanyId);
      if (syncResult.success) {
        synced++;
      } else {
        errorCount++;
      }
    }

    hasNextPage = companies.pageInfo.hasNextPage;
    cursor = companies.pageInfo.endCursor;
  }

  // Mark companies not in Shopify as inactive (soft delete)
  const existingCompanies = await prisma.company.findMany({
    where: { shopId, isActive: true },
    select: { id: true, shopifyCompanyId: true },
  });

  const companiesToDeactivate = existingCompanies.filter(
    (c) => c.shopifyCompanyId && !shopifyCompanyIds.has(c.shopifyCompanyId)
  );

  if (companiesToDeactivate.length > 0) {
    await prisma.company.updateMany({
      where: {
        id: { in: companiesToDeactivate.map((c) => c.id) },
      },
      data: {
        isActive: false,
        syncStatus: "SYNCED",
        lastSyncedAt: new Date(),
      },
    });
    console.log(`[Sync] Deactivated ${companiesToDeactivate.length} companies not found in Shopify`);
  }

  return {
    synced,
    deleted: companiesToDeactivate.length,
    errors: errorCount,
  };
}

/**
 * Sync all products for a shop
 * Fetches products from Shopify and upserts to local database
 */
async function syncProductsForShop(
  shopId: string,
  productInclusionTag: string | null,
  admin: { graphql: (query: string, options?: { variables: Record<string, unknown> }) => Promise<Response> }
): Promise<{ synced: number; deleted: number; errors: number }> {
  let hasNextPage = true;
  let cursor: string | null = null;
  let synced = 0;
  let errorCount = 0;
  const shopifyProductIds = new Set<string>();
  const now = new Date();

  while (hasNextPage) {
    const response = await admin.graphql(PRODUCTS_QUERY, {
      variables: { first: 50, after: cursor },
    });

    const result = await response.json() as {
      data?: {
        products: {
          pageInfo: { hasNextPage: boolean; endCursor: string | null };
          edges: Array<{
            node: {
              id: string;
              title: string;
              descriptionHtml: string | null;
              vendor: string | null;
              productType: string | null;
              status: string;
              tags: string[];
              featuredImage: { url: string } | null;
              variants: {
                edges: Array<{
                  node: {
                    id: string;
                    title: string;
                    sku: string | null;
                    price: string;
                    compareAtPrice: string | null;
                    inventoryQuantity: number | null;
                    position: number;
                  };
                }>;
              };
            };
          }>;
        };
      };
    };

    const products = result.data?.products;
    if (!products) break;

    for (const edge of products.edges) {
      const node = edge.node;
      const shopifyProductId = fromGid(node.id);
      shopifyProductIds.add(shopifyProductId);

      try {
        // Check for inclusion tag
        const shouldAutoEnable = productInclusionTag
          ? node.tags.some((t) => t.toLowerCase() === productInclusionTag.toLowerCase())
          : false;

        // Check existing product to preserve manual enablement
        const existingProduct = await prisma.product.findUnique({
          where: { shopId_shopifyProductId: { shopId, shopifyProductId } },
          select: { id: true, enabledForFieldApp: true },
        });

        const enabledForFieldApp = shouldAutoEnable || (existingProduct?.enabledForFieldApp ?? false);

        // Upsert product
        const product = await prisma.product.upsert({
          where: { shopId_shopifyProductId: { shopId, shopifyProductId } },
          create: {
            shopId,
            shopifyProductId,
            title: node.title,
            description: node.descriptionHtml,
            imageUrl: node.featuredImage?.url || null,
            productType: node.productType,
            vendor: node.vendor,
            tags: node.tags,
            status: mapProductStatus(node.status),
            isActive: node.status === "ACTIVE",
            enabledForFieldApp,
            syncedAt: now,
          },
          update: {
            title: node.title,
            description: node.descriptionHtml,
            imageUrl: node.featuredImage?.url || null,
            productType: node.productType,
            vendor: node.vendor,
            tags: node.tags,
            status: mapProductStatus(node.status),
            isActive: node.status === "ACTIVE",
            enabledForFieldApp,
            syncedAt: now,
          },
        });

        // Sync variants
        const existingVariants = await prisma.productVariant.findMany({
          where: { productId: product.id },
          select: { shopifyVariantId: true },
        });
        const existingVariantIds = new Set(existingVariants.map((v) => v.shopifyVariantId));
        const incomingVariantIds = new Set<string>();

        for (const variantEdge of node.variants.edges) {
          const variant = variantEdge.node;
          const shopifyVariantId = fromGid(variant.id);
          incomingVariantIds.add(shopifyVariantId);

          await prisma.productVariant.upsert({
            where: { productId_shopifyVariantId: { productId: product.id, shopifyVariantId } },
            create: {
              productId: product.id,
              shopifyVariantId,
              title: variant.title,
              sku: variant.sku,
              priceCents: Math.round(parseFloat(variant.price) * 100),
              comparePriceCents: variant.compareAtPrice
                ? Math.round(parseFloat(variant.compareAtPrice) * 100)
                : null,
              inventoryQuantity: variant.inventoryQuantity,
              isAvailable: true,
              position: variant.position,
            },
            update: {
              title: variant.title,
              sku: variant.sku,
              priceCents: Math.round(parseFloat(variant.price) * 100),
              comparePriceCents: variant.compareAtPrice
                ? Math.round(parseFloat(variant.compareAtPrice) * 100)
                : null,
              inventoryQuantity: variant.inventoryQuantity,
              position: variant.position,
            },
          });
        }

        // Delete variants that no longer exist
        const variantsToDelete = [...existingVariantIds].filter(
          (id) => !incomingVariantIds.has(id)
        );
        if (variantsToDelete.length > 0) {
          await prisma.productVariant.deleteMany({
            where: {
              productId: product.id,
              shopifyVariantId: { in: variantsToDelete },
            },
          });
        }

        synced++;
      } catch (error) {
        console.error(`[Sync] Error syncing product ${shopifyProductId}:`, error);
        errorCount++;
      }
    }

    hasNextPage = products.pageInfo.hasNextPage;
    cursor = products.pageInfo.endCursor;
  }

  // Delete products that no longer exist in Shopify
  const existingProducts = await prisma.product.findMany({
    where: { shopId },
    select: { id: true, shopifyProductId: true },
  });

  const productsToDelete = existingProducts.filter(
    (p) => !shopifyProductIds.has(p.shopifyProductId)
  );

  if (productsToDelete.length > 0) {
    await prisma.product.deleteMany({
      where: {
        id: { in: productsToDelete.map((p) => p.id) },
      },
    });
    console.log(`[Sync] Deleted ${productsToDelete.length} products not found in Shopify`);
  }

  return {
    synced,
    deleted: productsToDelete.length,
    errors: errorCount,
  };
}

// ============================================
// ORDER VALIDATION
// ============================================

/**
 * Validate that all products/variants in an order still exist in Shopify
 * Call this before submitting an order to prevent issues
 */
export async function validateOrderProducts(
  shopId: string,
  variantIds: string[]
): Promise<{
  valid: boolean;
  missingVariants: string[];
  syncRecommended: boolean;
}> {
  // Check which variants exist in our local database
  const existingVariants = await prisma.productVariant.findMany({
    where: {
      shopifyVariantId: { in: variantIds },
      product: { shopId },
    },
    select: { shopifyVariantId: true },
  });

  const existingIds = new Set(existingVariants.map((v) => v.shopifyVariantId));
  const missingVariants = variantIds.filter((id) => !existingIds.has(id));

  // If variants are missing, they might have been deleted from Shopify
  // Recommend a sync to verify
  const syncRecommended = missingVariants.length > 0;

  return {
    valid: missingVariants.length === 0,
    missingVariants,
    syncRecommended,
  };
}

/**
 * Validate order products against Shopify directly
 * Use when local validation fails to confirm if products exist in Shopify
 */
export async function validateOrderProductsWithShopify(
  shopId: string,
  variantIds: string[]
): Promise<{
  valid: boolean;
  missingVariants: string[];
  existingVariants: string[];
}> {
  const shop = await prisma.shop.findUnique({
    where: { id: shopId },
    select: { shopifyDomain: true },
  });

  if (!shop) {
    return { valid: false, missingVariants: variantIds, existingVariants: [] };
  }

  const { admin } = await unauthenticated.admin(shop.shopifyDomain);

  const existingVariants: string[] = [];
  const missingVariants: string[] = [];

  // Check each variant (batch if many)
  for (const variantId of variantIds) {
    try {
      const response = await admin.graphql(`
        query CheckVariant($id: ID!) {
          productVariant(id: $id) {
            id
            product {
              status
            }
          }
        }
      `, {
        variables: { id: toGid("ProductVariant", variantId) },
      });

      const result = await response.json() as {
        data?: {
          productVariant: {
            id: string;
            product: { status: string };
          } | null;
        };
      };

      const variant = result.data?.productVariant;
      if (variant && variant.product.status === "ACTIVE") {
        existingVariants.push(variantId);
      } else {
        missingVariants.push(variantId);
      }
    } catch {
      missingVariants.push(variantId);
    }
  }

  return {
    valid: missingVariants.length === 0,
    missingVariants,
    existingVariants,
  };
}

// ============================================
// HELPERS
// ============================================

function normalizeObjectTypes(objects?: SyncObjectType | SyncObjectType[]): SyncObjectType[] {
  if (!objects) return ["all"];
  if (Array.isArray(objects)) return objects;
  return [objects];
}

function mapProductStatus(status: string): "ACTIVE" | "ARCHIVED" | "DRAFT" {
  switch (status.toUpperCase()) {
    case "ACTIVE":
      return "ACTIVE";
    case "ARCHIVED":
      return "ARCHIVED";
    case "DRAFT":
      return "DRAFT";
    default:
      return "DRAFT";
  }
}
