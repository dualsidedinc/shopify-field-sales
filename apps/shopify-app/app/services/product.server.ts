import prisma from "../db.server";
import {
  getCatalogPricingForLocation,
  getAvailableVariantsForLocation,
  type CatalogPricing,
} from "./catalog.server";

export interface ProductVariantResult {
  id: string;
  shopifyProductId: string;
  shopifyVariantId: string;
  title: string;
  variantTitle: string | null;
  sku: string | null;
  imageUrl: string | null;
  priceCents: number;
  basePriceCents: number;
  hasCatalogPrice: boolean;
  isInCatalog: boolean;
  // Quantity rules (from catalog, if applicable)
  quantityMin: number | null;
  quantityMax: number | null;
  quantityIncrement: number | null;
  // Volume pricing tiers
  priceBreaks: Array<{ minimumQuantity: number; priceCents: number }>;
}

export interface ProductQueryOptions {
  companyLocationId?: string;
}

/**
 * Get all products enabled for field app (for browse picker)
 * When companyLocationId is provided, applies catalog pricing and availability
 */
export async function getEnabledProducts(
  shopId: string,
  options?: ProductQueryOptions
): Promise<ProductVariantResult[]> {
  const products = await prisma.product.findMany({
    where: {
      shopId,
      enabledForFieldApp: true,
      isActive: true,
      status: "ACTIVE",
    },
    include: {
      variants: {
        where: {
          isAvailable: true,
        },
        orderBy: {
          position: "asc",
        },
      },
    },
    orderBy: {
      title: "asc",
    },
  });

  // Get catalog pricing if a location is specified
  let catalogPricing: Map<string, CatalogPricing> | null = null;
  let availableVariants: Set<string> | null = null;
  const hasCatalog = !!options?.companyLocationId;

  if (options?.companyLocationId) {
    [catalogPricing, availableVariants] = await Promise.all([
      getCatalogPricingForLocation(options.companyLocationId),
      getAvailableVariantsForLocation(options.companyLocationId),
    ]);
  }

  // Flatten products into variant-level results
  const results: ProductVariantResult[] = [];

  for (const product of products) {
    for (const variant of product.variants) {
      const catalogPrice = catalogPricing?.get(variant.shopifyVariantId);
      const isInCatalog = !hasCatalog || !availableVariants || availableVariants.has(variant.shopifyVariantId);

      // Skip variants not in catalog when catalog is active
      if (hasCatalog && availableVariants && availableVariants.size > 0 && !isInCatalog) {
        continue;
      }

      results.push({
        id: variant.id,
        shopifyProductId: product.shopifyProductId,
        shopifyVariantId: variant.shopifyVariantId,
        title: product.title,
        variantTitle: variant.title !== "Default Title" ? variant.title : null,
        sku: variant.sku,
        imageUrl: variant.imageUrl || product.imageUrl,
        basePriceCents: variant.priceCents,
        priceCents: catalogPrice?.priceCents ?? variant.priceCents,
        hasCatalogPrice: !!catalogPrice,
        isInCatalog,
        // Quantity rules from catalog
        quantityMin: catalogPrice?.quantityMin ?? null,
        quantityMax: catalogPrice?.quantityMax ?? null,
        quantityIncrement: catalogPrice?.quantityIncrement ?? null,
        // Volume pricing
        priceBreaks: catalogPrice?.priceBreaks ?? [],
      });
    }
  }

  return results;
}

/**
 * Search products enabled for field app
 * When companyLocationId is provided, applies catalog pricing and availability
 */
export async function searchProducts(
  shopId: string,
  query: string,
  options?: ProductQueryOptions
): Promise<ProductVariantResult[]> {
  const products = await prisma.product.findMany({
    where: {
      shopId,
      enabledForFieldApp: true,
      isActive: true,
      status: "ACTIVE",
      OR: [
        { title: { contains: query, mode: "insensitive" } },
        { variants: { some: { sku: { contains: query, mode: "insensitive" } } } },
      ],
    },
    include: {
      variants: {
        where: {
          isAvailable: true,
        },
        orderBy: {
          position: "asc",
        },
      },
    },
    orderBy: {
      title: "asc",
    },
    take: 20,
  });

  // Get catalog pricing if a location is specified
  let catalogPricing: Map<string, CatalogPricing> | null = null;
  let availableVariants: Set<string> | null = null;
  const hasCatalog = !!options?.companyLocationId;

  if (options?.companyLocationId) {
    [catalogPricing, availableVariants] = await Promise.all([
      getCatalogPricingForLocation(options.companyLocationId),
      getAvailableVariantsForLocation(options.companyLocationId),
    ]);
  }

  // Flatten and filter by query match
  const results: ProductVariantResult[] = [];
  const lowerQuery = query.toLowerCase();

  for (const product of products) {
    for (const variant of product.variants) {
      // Include if product title or variant SKU matches
      const titleMatch = product.title.toLowerCase().includes(lowerQuery);
      const skuMatch = variant.sku?.toLowerCase().includes(lowerQuery);

      if (titleMatch || skuMatch) {
        const catalogPrice = catalogPricing?.get(variant.shopifyVariantId);
        const isInCatalog = !hasCatalog || !availableVariants || availableVariants.has(variant.shopifyVariantId);

        // Skip variants not in catalog when catalog is active
        if (hasCatalog && availableVariants && availableVariants.size > 0 && !isInCatalog) {
          continue;
        }

        results.push({
          id: variant.id,
          shopifyProductId: product.shopifyProductId,
          shopifyVariantId: variant.shopifyVariantId,
          title: product.title,
          variantTitle: variant.title !== "Default Title" ? variant.title : null,
          sku: variant.sku,
          imageUrl: variant.imageUrl || product.imageUrl,
          basePriceCents: variant.priceCents,
          priceCents: catalogPrice?.priceCents ?? variant.priceCents,
          hasCatalogPrice: !!catalogPrice,
          isInCatalog,
          // Quantity rules from catalog
          quantityMin: catalogPrice?.quantityMin ?? null,
          quantityMax: catalogPrice?.quantityMax ?? null,
          quantityIncrement: catalogPrice?.quantityIncrement ?? null,
          // Volume pricing
          priceBreaks: catalogPrice?.priceBreaks ?? [],
        });
      }
    }
  }

  return results;
}
