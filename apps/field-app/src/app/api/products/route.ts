import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { getAuthContext } from '@/lib/auth';
import type { ApiError } from '@/types';

export interface PriceBreak {
  minimumQuantity: number;
  priceCents: number;
}

export interface ProductVariant {
  id: string;
  shopifyVariantId: string;
  title: string;
  sku: string | null;
  priceCents: number;
  basePriceCents: number;
  hasCatalogPrice: boolean;
  available: boolean;
  inventoryQuantity: number | null;
  // Quantity rules from B2B catalog
  quantityMin: number | null;
  quantityMax: number | null;
  quantityIncrement: number | null;
  priceBreaks: PriceBreak[];
}

export interface ProductListItem {
  id: string;
  shopifyProductId: string;
  title: string;
  description: string | null;
  imageUrl: string | null;
  productType: string | null;
  vendor: string | null;
  variants: ProductVariant[];
}

export interface ProductsResponse {
  items: ProductListItem[];
  pagination: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
}

interface CatalogItemData {
  priceCents: number;
  compareAtPriceCents: number | null;
  quantityMin: number | null;
  quantityMax: number | null;
  quantityIncrement: number | null;
  priceBreaks: PriceBreak[];
}

/**
 * Get catalog pricing for a company location
 * Returns a map of shopifyVariantId -> catalog item data with pricing, rules, and price breaks
 */
async function getCatalogPricing(
  companyLocationId: string
): Promise<Map<string, CatalogItemData>> {
  const catalogItems = await prisma.catalogItem.findMany({
    where: {
      catalog: {
        status: 'ACTIVE',
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
          minimumQuantity: 'asc',
        },
      },
    },
  });

  return new Map(
    catalogItems.map((item) => [
      item.shopifyVariantId,
      {
        priceCents: item.priceCents,
        compareAtPriceCents: item.compareAtPriceCents,
        quantityMin: item.quantityMin,
        quantityMax: item.quantityMax,
        quantityIncrement: item.quantityIncrement,
        priceBreaks: item.priceBreaks,
      },
    ])
  );
}

/**
 * Get available variants for a company location (variants in active catalogs)
 */
async function getAvailableVariants(companyLocationId: string): Promise<Set<string>> {
  const catalogItems = await prisma.catalogItem.findMany({
    where: {
      catalog: {
        status: 'ACTIVE',
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

export async function GET(request: Request) {
  try {
    const { shopId } = await getAuthContext();
    const { searchParams } = new URL(request.url);

    const query = searchParams.get('query') || '';
    const companyLocationId = searchParams.get('companyLocationId');
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
    const pageSize = Math.min(50, Math.max(1, parseInt(searchParams.get('pageSize') || '20')));

    const skip = (page - 1) * pageSize;

    // Get catalog pricing if location is provided
    let catalogPricing: Map<string, CatalogItemData> | null = null;
    let availableVariants: Set<string> | null = null;
    const hasCatalog = !!companyLocationId;

    if (companyLocationId) {
      [catalogPricing, availableVariants] = await Promise.all([
        getCatalogPricing(companyLocationId),
        getAvailableVariants(companyLocationId),
      ]);
    }

    // Build where clause
    const where = {
      shopId,
      enabledForFieldApp: true,
      isActive: true,
      ...(query && {
        OR: [
          { title: { contains: query, mode: 'insensitive' as const } },
          { variants: { some: { sku: { contains: query, mode: 'insensitive' as const } } } },
        ],
      }),
    };

    const [products, totalItems] = await Promise.all([
      prisma.product.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { title: 'asc' },
        include: {
          variants: {
            orderBy: { position: 'asc' },
          },
        },
      }),
      prisma.product.count({ where }),
    ]);

    // Process products and apply catalog pricing
    const items: ProductListItem[] = products
      .map((product) => {
        // Filter variants by catalog availability if a catalog exists
        const filteredVariants = product.variants.filter((variant) => {
          // If no catalog or no available variants list, include all
          if (!hasCatalog || !availableVariants || availableVariants.size === 0) {
            return true;
          }
          // Otherwise, only include variants in the catalog
          return availableVariants.has(variant.shopifyVariantId);
        });

        // Skip products with no available variants
        if (filteredVariants.length === 0) {
          return null;
        }

        return {
          id: product.id,
          shopifyProductId: product.shopifyProductId,
          title: product.title,
          description: product.description,
          imageUrl: product.imageUrl,
          productType: product.productType,
          vendor: product.vendor,
          variants: filteredVariants.map((variant) => {
            const catalogData = catalogPricing?.get(variant.shopifyVariantId);
            return {
              id: variant.id,
              shopifyVariantId: variant.shopifyVariantId,
              title: variant.title,
              sku: variant.sku,
              basePriceCents: variant.priceCents,
              priceCents: catalogData?.priceCents ?? variant.priceCents,
              hasCatalogPrice: !!catalogData,
              available: variant.isAvailable,
              inventoryQuantity: variant.inventoryQuantity,
              // Quantity rules from B2B catalog
              quantityMin: catalogData?.quantityMin ?? null,
              quantityMax: catalogData?.quantityMax ?? null,
              quantityIncrement: catalogData?.quantityIncrement ?? null,
              priceBreaks: catalogData?.priceBreaks ?? [],
            };
          }),
        };
      })
      .filter((item): item is ProductListItem => item !== null);

    const totalPages = Math.ceil(totalItems / pageSize);

    const response: ProductsResponse = {
      items,
      pagination: {
        page,
        pageSize,
        totalItems,
        totalPages,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1,
      },
    };

    return NextResponse.json({ data: response, error: null });
  } catch (error) {
    console.error('Error fetching products:', error);
    return NextResponse.json<ApiError>(
      {
        data: null,
        error: {
          code: 'INTERNAL_ERROR',
          message: error instanceof Error ? error.message : 'Failed to fetch products',
        },
      },
      { status: 500 }
    );
  }
}
