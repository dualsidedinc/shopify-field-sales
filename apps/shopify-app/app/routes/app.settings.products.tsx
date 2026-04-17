import type { LoaderFunctionArgs, ActionFunctionArgs, HeadersFunction } from "react-router";
import { useLoaderData, useFetcher } from "react-router";
import { useState, useEffect, useCallback, useMemo } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { prisma } from "@field-sales/database";
import type { ProductStatus } from "@prisma/client";
import { fromGid } from "../lib/shopify-ids";

type AdminGraphQL = {
  graphql: (query: string, options?: { variables: Record<string, unknown> }) => Promise<Response>;
};

interface ProductListItem {
  id: string;
  title: string;
  vendor: string | null;
  productType: string | null;
  status: string;
  imageUrl: string | null;
  variantCount: number;
  enabledForFieldApp: boolean;
  tags: string[];
}

interface LoaderData {
  products: ProductListItem[];
  shopId: string | null;
  productInclusionTag: string | null;
  totalCount: number;
}

interface ActionData {
  success?: boolean;
  message?: string;
  error?: string;
  synced?: number;
  errors?: number;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: session.shop },
  });

  if (!shop) {
    return { products: [], shopId: null, productInclusionTag: null, totalCount: 0 };
  }

  const products = await prisma.product.findMany({
    where: { shopId: shop.id },
    orderBy: { title: "asc" },
    include: {
      _count: { select: { variants: true } },
    },
  });

  const productList: ProductListItem[] = products.map((p) => ({
    id: p.id,
    title: p.title,
    vendor: p.vendor,
    productType: p.productType,
    status: p.status,
    imageUrl: p.imageUrl,
    variantCount: p._count.variants,
    enabledForFieldApp: p.enabledForFieldApp,
    tags: p.tags,
  }));

  return {
    products: productList,
    shopId: shop.id,
    productInclusionTag: shop.productInclusionTag,
    totalCount: products.length,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);

  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: session.shop },
  });

  if (!shop) {
    return { success: false, error: "Shop not found" };
  }

  const formData = await request.formData();
  const actionType = formData.get("_action");

  if (actionType === "sync") {
    const result = await syncProductsFromShopify(shop.id, admin);
    return result;
  }

  if (actionType === "enable") {
    const productIds = formData.getAll("productIds") as string[];
    await prisma.product.updateMany({
      where: { id: { in: productIds }, shopId: shop.id },
      data: { enabledForFieldApp: true },
    });
    return { success: true, message: `Enabled ${productIds.length} products for field app` };
  }

  if (actionType === "disable") {
    const productIds = formData.getAll("productIds") as string[];
    await prisma.product.updateMany({
      where: { id: { in: productIds }, shopId: shop.id },
      data: { enabledForFieldApp: false },
    });
    return { success: true, message: `Disabled ${productIds.length} products for field app` };
  }

  if (actionType === "setInclusionTag") {
    const tag = formData.get("tag") as string;
    await prisma.shop.update({
      where: { id: shop.id },
      data: { productInclusionTag: tag || null },
    });

    if (tag) {
      // Auto-enable matching products (case-insensitive tag match)
      const allProducts = await prisma.product.findMany({
        where: { shopId: shop.id },
        select: { id: true, tags: true },
      });

      const lowerTag = tag.toLowerCase();
      const matchingIds = allProducts
        .filter((p) => p.tags.some((t) => t.toLowerCase() === lowerTag))
        .map((p) => p.id);

      if (matchingIds.length > 0) {
        await prisma.product.updateMany({
          where: { id: { in: matchingIds } },
          data: { enabledForFieldApp: true },
        });
      }

      return {
        success: true,
        message: `Inclusion tag set to "${tag}". ${matchingIds.length} products auto-enabled.`,
      };
    }

    return { success: true, message: "Inclusion tag cleared" };
  }

  return { success: false, error: "Unknown action" };
};

interface ShopifyProductsResponse {
  data?: {
    products: {
      edges: Array<{
        cursor: string;
        node: {
          id: string;
          title: string;
          descriptionHtml: string | null;
          status: string;
          productType: string | null;
          vendor: string | null;
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
                availableForSale: boolean;
                position: number;
                image: { url: string } | null;
              };
            }>;
          };
        };
      }>;
      pageInfo: {
        hasNextPage: boolean;
        endCursor: string | null;
      };
    };
  };
  errors?: unknown;
}

function mapStatus(status: string): ProductStatus {
  switch (status) {
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

async function syncProductsFromShopify(
  shopId: string,
  admin: AdminGraphQL
): Promise<ActionData> {
  const shop = await prisma.shop.findUnique({
    where: { id: shopId },
    select: { productInclusionTag: true },
  });

  const inclusionTag = shop?.productInclusionTag?.toLowerCase() ?? null;
  let synced = 0;
  let errors = 0;
  let hasNextPage = true;
  let cursor: string | null = null;

  while (hasNextPage) {
    const response = await admin.graphql(
      `#graphql
        query Products($first: Int!, $after: String) {
          products(first: $first, after: $after) {
            edges {
              cursor
              node {
                id
                title
                descriptionHtml
                status
                productType
                vendor
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
                      availableForSale
                      position
                      image {
                        url
                      }
                    }
                  }
                }
              }
            }
            pageInfo {
              hasNextPage
              endCursor
            }
          }
        }
      `,
      { variables: { first: 50, after: cursor } }
    );

    const data = (await response.json()) as ShopifyProductsResponse;
    const productsData = data.data?.products;

    if (!productsData) {
      console.error("Failed to fetch products:", data.errors);
      break;
    }

    for (const edge of productsData.edges) {
      try {
        const node = edge.node;
        const tags = node.tags || [];
        const shouldAutoEnable = inclusionTag
          ? tags.some((t: string) => t.toLowerCase() === inclusionTag)
          : false;

        // Extract numeric ID from Shopify GID
        const shopifyProductId = fromGid(node.id);

        const existing = await prisma.product.findUnique({
          where: {
            shopId_shopifyProductId: { shopId, shopifyProductId },
          },
          select: { enabledForFieldApp: true },
        });

        const enabledForFieldApp = shouldAutoEnable || (existing?.enabledForFieldApp ?? false);

        const product = await prisma.product.upsert({
          where: {
            shopId_shopifyProductId: { shopId, shopifyProductId },
          },
          create: {
            shopId,
            shopifyProductId,
            title: node.title,
            description: node.descriptionHtml,
            imageUrl: node.featuredImage?.url ?? null,
            productType: node.productType,
            vendor: node.vendor,
            tags,
            status: mapStatus(node.status),
            isActive: node.status === "ACTIVE",
            enabledForFieldApp,
            syncedAt: new Date(),
          },
          update: {
            title: node.title,
            description: node.descriptionHtml,
            imageUrl: node.featuredImage?.url ?? null,
            productType: node.productType,
            vendor: node.vendor,
            tags,
            status: mapStatus(node.status),
            isActive: node.status === "ACTIVE",
            enabledForFieldApp,
            syncedAt: new Date(),
          },
        });

        for (const variantEdge of node.variants.edges) {
          const v = variantEdge.node;
          const shopifyVariantId = fromGid(v.id);
          await prisma.productVariant.upsert({
            where: {
              productId_shopifyVariantId: {
                productId: product.id,
                shopifyVariantId,
              },
            },
            create: {
              productId: product.id,
              shopifyVariantId,
              title: v.title,
              sku: v.sku,
              priceCents: Math.round(parseFloat(v.price) * 100),
              comparePriceCents: v.compareAtPrice
                ? Math.round(parseFloat(v.compareAtPrice) * 100)
                : null,
              imageUrl: v.image?.url ?? null,
              inventoryQuantity: v.inventoryQuantity,
              isAvailable: v.availableForSale,
              position: v.position,
            },
            update: {
              title: v.title,
              sku: v.sku,
              priceCents: Math.round(parseFloat(v.price) * 100),
              comparePriceCents: v.compareAtPrice
                ? Math.round(parseFloat(v.compareAtPrice) * 100)
                : null,
              imageUrl: v.image?.url ?? null,
              inventoryQuantity: v.inventoryQuantity,
              isAvailable: v.availableForSale,
              position: v.position,
            },
          });
        }

        synced++;
      } catch (error) {
        console.error(`Failed to sync product ${edge.node.id}:`, error);
        errors++;
      }
    }

    hasNextPage = productsData.pageInfo.hasNextPage;
    cursor = productsData.pageInfo.endCursor;
  }

  return { success: true, synced, errors, message: `Synced ${synced} products` };
}

export default function ProductsPage() {
  const { products, shopId, productInclusionTag, totalCount } = useLoaderData<LoaderData>();
  const fetcher = useFetcher<ActionData>();
  const shopify = useAppBridge();

  const [selectedProducts, setSelectedProducts] = useState<Set<string>>(new Set());
  const [inclusionTag, setInclusionTag] = useState(productInclusionTag || "");
  const [searchQuery, setSearchQuery] = useState("");

  const isSyncing = fetcher.state !== "idle" && fetcher.formData?.get("_action") === "sync";
  const isUpdating = fetcher.state !== "idle" && fetcher.formData?.get("_action") !== "sync";

  const filteredProducts = useMemo(() => {
    if (!searchQuery.trim()) return products;
    const query = searchQuery.toLowerCase();
    return products.filter(
      (p) =>
        p.title.toLowerCase().includes(query) ||
        p.vendor?.toLowerCase().includes(query) ||
        p.productType?.toLowerCase().includes(query)
    );
  }, [products, searchQuery]);

  useEffect(() => {
    if (fetcher.data?.success && fetcher.data?.message) {
      shopify.toast.show(fetcher.data.message);
      setSelectedProducts(new Set());
    }
    if (fetcher.data?.error) {
      shopify.toast.show(fetcher.data.error, { isError: true });
    }
  }, [fetcher.data, shopify]);

  const handleSelectAll = useCallback(() => {
    if (selectedProducts.size === filteredProducts.length) {
      setSelectedProducts(new Set());
    } else {
      setSelectedProducts(new Set(filteredProducts.map((p) => p.id)));
    }
  }, [filteredProducts, selectedProducts.size]);

  const handleSelectProduct = useCallback((productId: string) => {
    setSelectedProducts((prev) => {
      const next = new Set(prev);
      if (next.has(productId)) {
        next.delete(productId);
      } else {
        next.add(productId);
      }
      return next;
    });
  }, []);

  const handleBulkEnable = () => {
    const formData = new FormData();
    formData.set("_action", "enable");
    selectedProducts.forEach((id) => formData.append("productIds", id));
    fetcher.submit(formData, { method: "POST" });
  };

  const handleBulkDisable = () => {
    const formData = new FormData();
    formData.set("_action", "disable");
    selectedProducts.forEach((id) => formData.append("productIds", id));
    fetcher.submit(formData, { method: "POST" });
  };

  const handleSync = () => {
    fetcher.submit({ _action: "sync" }, { method: "POST" });
  };

  const handleSetInclusionTag = () => {
    fetcher.submit({ _action: "setInclusionTag", tag: inclusionTag }, { method: "POST" });
  };

  if (!shopId) {
    return (
      <s-page heading="Products">
        <s-section>
          <s-stack gap="base">
            <s-heading>Setup Required</s-heading>
            <s-paragraph>
              Your store needs to complete setup before managing products.
            </s-paragraph>
          </s-stack>
        </s-section>
      </s-page>
    );
  }

  const enabledCount = products.filter((p) => p.enabledForFieldApp).length;

  return (
    <s-page heading="Products">
      <s-link slot="breadcrumb-actions" href="/app/settings">
        Settings
      </s-link>
      <s-button slot="secondary-actions" onClick={handleSync} disabled={isSyncing}>
        {isSyncing ? "Syncing..." : "Sync from Shopify"}
      </s-button>

      {/* Inclusion Tag Settings */}
      <s-section>
        <s-stack gap="base">
          <s-heading>Auto-Enable Settings</s-heading>
          <s-paragraph>
            Products with this tag will be automatically enabled for the field app when synced.
          </s-paragraph>
          <s-grid gap="base" gridTemplateColumns="1fr auto">
            <s-text-field
              label="Inclusion Tag"
              value={inclusionTag}
              onInput={(e: Event) => {
                const target = e.target as HTMLInputElement;
                setInclusionTag(target.value);
              }}
              placeholder="e.g., field-sales"
            />
            <s-box paddingBlockStart="base">
              <s-button onClick={handleSetInclusionTag} disabled={isUpdating}>
                Save Tag
              </s-button>
            </s-box>
          </s-grid>
          {productInclusionTag && (
            <s-text color="subdued">
              Current tag: <s-badge>{productInclusionTag}</s-badge>
            </s-text>
          )}
        </s-stack>
      </s-section>

      {/* Summary Stats */}
      <s-section>
        <s-grid gap="base" gridTemplateColumns="1fr 1fr">
          <s-box padding="base" background="subdued" borderRadius="base">
            <s-stack gap="none">
              <s-text color="subdued">Total Products</s-text>
              <s-heading>{totalCount}</s-heading>
            </s-stack>
          </s-box>
          <s-box padding="base" background="subdued" borderRadius="base">
            <s-stack gap="none">
              <s-text color="subdued">Enabled for Field App</s-text>
              <s-heading>{enabledCount}</s-heading>
            </s-stack>
          </s-box>
        </s-grid>
      </s-section>

      {/* Bulk Actions */}
      {selectedProducts.size > 0 && (
        <s-section>
          <s-grid gap="base" gridTemplateColumns="auto 1fr 1fr">
            <s-text>{selectedProducts.size} selected</s-text>
            <s-button onClick={handleBulkEnable} disabled={isUpdating}>
              Enable for Field App
            </s-button>
            <s-button onClick={handleBulkDisable} variant="secondary" disabled={isUpdating}>
              Disable for Field App
            </s-button>
          </s-grid>
        </s-section>
      )}

      {/* Product Table */}
      <s-section padding="none" accessibilityLabel="Products list">
        {products.length === 0 ? (
          <s-box padding="base">
            <s-stack gap="base">
              <s-heading>No products synced</s-heading>
              <s-paragraph>
                Click "Sync from Shopify" to import your product catalog.
              </s-paragraph>
            </s-stack>
          </s-box>
        ) : (
          <s-table>
            <s-grid slot="filters" gap="small-200" gridTemplateColumns="1fr">
              <s-text-field
                icon="search"
                label="Search products"
                labelAccessibilityVisibility="exclusive"
                placeholder="Search by title, vendor, or type..."
                autocomplete="off"
                value={searchQuery}
                onInput={(e: Event) => {
                  const target = e.target as HTMLInputElement;
                  setSearchQuery(target.value);
                }}
              />
            </s-grid>

            <s-table-header-row>
              <s-table-header>
                <s-checkbox
                  checked={selectedProducts.size === filteredProducts.length && filteredProducts.length > 0}
                  onChange={handleSelectAll}
                />
              </s-table-header>
              <s-table-header>Product</s-table-header>
              <s-table-header>Type</s-table-header>
              <s-table-header>Vendor</s-table-header>
              <s-table-header>Variants</s-table-header>
              <s-table-header>Status</s-table-header>
              <s-table-header>Field App</s-table-header>
            </s-table-header-row>

            <s-table-body>
              {filteredProducts.length === 0 ? (
                <s-table-row>
                  <s-table-cell />
                  <s-table-cell>
                    <s-text color="subdued">No products match your search.</s-text>
                  </s-table-cell>
                  <s-table-cell />
                  <s-table-cell />
                  <s-table-cell />
                  <s-table-cell />
                  <s-table-cell />
                </s-table-row>
              ) : (
                filteredProducts.map((product) => (
                  <s-table-row key={product.id}>
                    <s-table-cell>
                      <s-checkbox
                        checked={selectedProducts.has(product.id)}
                        onChange={() => handleSelectProduct(product.id)}
                      />
                    </s-table-cell>
                    <s-table-cell>
                      <s-stack direction="inline" gap="base" alignItems="center">
                        {product.imageUrl && (
                          <s-thumbnail
                            src={product.imageUrl}
                            alt={product.title}
                            size="small"
                          />
                        )}
                        <s-heading>{product.title}</s-heading>
                      </s-stack>
                    </s-table-cell>
                    <s-table-cell>
                      <s-text color="subdued">{product.productType || "—"}</s-text>
                    </s-table-cell>
                    <s-table-cell>
                      <s-text color="subdued">{product.vendor || "—"}</s-text>
                    </s-table-cell>
                    <s-table-cell>{product.variantCount}</s-table-cell>
                    <s-table-cell>
                      {product.status === "ACTIVE" ? (
                        <s-badge tone="success">Active</s-badge>
                      ) : product.status === "DRAFT" ? (
                        <s-badge>Draft</s-badge>
                      ) : (
                        <s-badge tone="warning">Archived</s-badge>
                      )}
                    </s-table-cell>
                    <s-table-cell>
                      {product.enabledForFieldApp ? (
                        <s-badge tone="success">Enabled</s-badge>
                      ) : (
                        <s-badge>Disabled</s-badge>
                      )}
                    </s-table-cell>
                  </s-table-row>
                ))
              )}
            </s-table-body>
          </s-table>
        )}
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
