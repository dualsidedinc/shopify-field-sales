import { prisma } from "@field-sales/database";

/**
 * Metafield Service
 *
 * Manages Shopify metafield definitions and values for the Field Sales app.
 * All metafields use the 'field_sales' namespace for app-specific data.
 */

// =============================================================================
// Constants
// =============================================================================

export const METAFIELD_NAMESPACE = "field_sales";

// Order metafield keys
export const ORDER_METAFIELD_KEYS = {
  TERRITORY_CODE: "territory_code",
  TERRITORY_NAME: "territory_name",
  SALES_REP_EXTERNAL_ID: "sales_rep_external_id",
  SALES_REP_NAME: "sales_rep_name",
} as const;

// =============================================================================
// Types
// =============================================================================

export interface MetafieldDefinitionInput {
  namespace: string;
  key: string;
  name: string;
  description: string;
  type: string;
  ownerType: "ORDER" | "DRAFTORDER" | "PRODUCT" | "VARIANT" | "CUSTOMER" | "COMPANY";
}

export interface MetafieldInput {
  namespace: string;
  key: string;
  type: string;
  value: string;
}

export interface ShopifyAdmin {
  graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response>;
}

// =============================================================================
// Metafield Definitions
// =============================================================================

/**
 * Order metafield definitions for the Field Sales app.
 * These are created once per shop during app installation or setup.
 */
export const ORDER_METAFIELD_DEFINITIONS: MetafieldDefinitionInput[] = [
  {
    namespace: METAFIELD_NAMESPACE,
    key: ORDER_METAFIELD_KEYS.TERRITORY_CODE,
    name: "Territory Code",
    description: "The code of the territory this order was placed from",
    type: "single_line_text_field",
    ownerType: "ORDER",
  },
  {
    namespace: METAFIELD_NAMESPACE,
    key: ORDER_METAFIELD_KEYS.TERRITORY_NAME,
    name: "Territory Name",
    description: "The name of the territory this order was placed from",
    type: "single_line_text_field",
    ownerType: "ORDER",
  },
  {
    namespace: METAFIELD_NAMESPACE,
    key: ORDER_METAFIELD_KEYS.SALES_REP_EXTERNAL_ID,
    name: "Sales Rep External ID",
    description: "The external ID of the sales rep who placed this order",
    type: "single_line_text_field",
    ownerType: "ORDER",
  },
  {
    namespace: METAFIELD_NAMESPACE,
    key: ORDER_METAFIELD_KEYS.SALES_REP_NAME,
    name: "Sales Rep Name",
    description: "The name of the sales rep who placed this order",
    type: "single_line_text_field",
    ownerType: "ORDER",
  },
];

// =============================================================================
// GraphQL Mutations
// =============================================================================

const METAFIELD_DEFINITION_CREATE_MUTATION = `#graphql
  mutation MetafieldDefinitionCreate($definition: MetafieldDefinitionInput!) {
    metafieldDefinitionCreate(definition: $definition) {
      createdDefinition {
        id
        namespace
        key
        name
        type {
          name
        }
        ownerType
      }
      userErrors {
        field
        message
        code
      }
    }
  }
`;

const METAFIELD_DEFINITIONS_QUERY = `#graphql
  query MetafieldDefinitions($ownerType: MetafieldOwnerType!, $namespace: String!) {
    metafieldDefinitions(ownerType: $ownerType, namespace: $namespace, first: 50) {
      edges {
        node {
          id
          namespace
          key
          name
          type {
            name
          }
        }
      }
    }
  }
`;

const ORDER_METAFIELDS_SET_MUTATION = `#graphql
  mutation OrderMetafieldsSet($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields {
        id
        namespace
        key
        value
      }
      userErrors {
        field
        message
        code
      }
    }
  }
`;

// =============================================================================
// Definition Management
// =============================================================================

/**
 * Create a single metafield definition in Shopify
 */
export async function createMetafieldDefinition(
  admin: ShopifyAdmin,
  definition: MetafieldDefinitionInput
): Promise<{ success: boolean; id?: string; error?: string }> {
  try {
    const response = await admin.graphql(METAFIELD_DEFINITION_CREATE_MUTATION, {
      variables: {
        definition: {
          namespace: definition.namespace,
          key: definition.key,
          name: definition.name,
          description: definition.description,
          type: definition.type,
          ownerType: definition.ownerType,
        },
      },
    });

    const result = await response.json() as {
      data?: {
        metafieldDefinitionCreate?: {
          createdDefinition?: { id: string };
          userErrors?: Array<{ field: string[]; message: string; code: string }>;
        };
      };
    };

    const userErrors = result.data?.metafieldDefinitionCreate?.userErrors;
    if (userErrors && userErrors.length > 0) {
      // TAKEN error means definition already exists - not an error
      if (userErrors[0].code === "TAKEN") {
        console.log(`[Metafield] Definition ${definition.namespace}.${definition.key} already exists`);
        return { success: true };
      }
      console.error("[Metafield] Definition create errors:", userErrors);
      return { success: false, error: userErrors.map(e => e.message).join(", ") };
    }

    const createdId = result.data?.metafieldDefinitionCreate?.createdDefinition?.id;
    console.log(`[Metafield] Created definition ${definition.namespace}.${definition.key}: ${createdId}`);
    return { success: true, id: createdId };
  } catch (error) {
    console.error("[Metafield] Error creating definition:", error);
    return { success: false, error: "Failed to create metafield definition" };
  }
}

/**
 * Get existing metafield definitions for a namespace and owner type
 */
export async function getMetafieldDefinitions(
  admin: ShopifyAdmin,
  ownerType: MetafieldDefinitionInput["ownerType"],
  namespace: string = METAFIELD_NAMESPACE
): Promise<Array<{ id: string; namespace: string; key: string; name: string }>> {
  try {
    const response = await admin.graphql(METAFIELD_DEFINITIONS_QUERY, {
      variables: { ownerType, namespace },
    });

    const result = await response.json() as {
      data?: {
        metafieldDefinitions?: {
          edges: Array<{
            node: { id: string; namespace: string; key: string; name: string };
          }>;
        };
      };
    };

    return result.data?.metafieldDefinitions?.edges.map(e => e.node) || [];
  } catch (error) {
    console.error("[Metafield] Error fetching definitions:", error);
    return [];
  }
}

/**
 * Ensure all required order metafield definitions exist.
 * This is idempotent - safe to call multiple times.
 */
export async function ensureOrderMetafieldDefinitions(
  admin: ShopifyAdmin
): Promise<{ success: boolean; errors?: string[] }> {
  const errors: string[] = [];

  for (const definition of ORDER_METAFIELD_DEFINITIONS) {
    const result = await createMetafieldDefinition(admin, definition);
    if (!result.success && result.error) {
      errors.push(`${definition.key}: ${result.error}`);
    }
  }

  if (errors.length > 0) {
    console.error("[Metafield] Some definitions failed to create:", errors);
    return { success: false, errors };
  }

  console.log("[Metafield] All order metafield definitions ensured");
  return { success: true };
}

/**
 * Check if metafield definitions have been set up for a shop.
 * Uses the shop's metafieldsSetupAt timestamp to avoid repeated API calls.
 */
export async function isMetafieldSetupComplete(shopId: string): Promise<boolean> {
  const shop = await prisma.shop.findUnique({
    where: { id: shopId },
    select: { metafieldsSetupAt: true },
  });
  return shop?.metafieldsSetupAt !== null;
}

/**
 * Ensure metafield definitions exist for a shop, with caching.
 * Only calls Shopify API if definitions haven't been set up yet.
 * Safe to call on every order - checks database first.
 */
export async function ensureMetafieldSetupForShop(
  shopId: string,
  admin: ShopifyAdmin
): Promise<{ success: boolean; alreadySetup?: boolean; errors?: string[] }> {
  // Check if already set up
  const isSetup = await isMetafieldSetupComplete(shopId);
  if (isSetup) {
    return { success: true, alreadySetup: true };
  }

  console.log(`[Metafield] Setting up metafield definitions for shop ${shopId}`);

  // Create definitions
  const result = await ensureOrderMetafieldDefinitions(admin);

  if (result.success) {
    // Mark as set up in database
    await prisma.shop.update({
      where: { id: shopId },
      data: { metafieldsSetupAt: new Date() },
    });
    console.log(`[Metafield] Setup complete for shop ${shopId}`);
    return { success: true };
  }

  return { success: false, errors: result.errors };
}

// =============================================================================
// Order Metafield Values
// =============================================================================

export interface OrderMetafieldData {
  territoryCode?: string | null;
  territoryName?: string | null;
  salesRepExternalId?: string | null;
  salesRepName?: string | null;
}

/**
 * Build metafield inputs for a draft order.
 * These will be included in the draftOrderCreate/Update mutation input.
 */
export function buildOrderMetafields(data: OrderMetafieldData): MetafieldInput[] {
  const metafields: MetafieldInput[] = [];

  if (data.territoryCode) {
    metafields.push({
      namespace: METAFIELD_NAMESPACE,
      key: ORDER_METAFIELD_KEYS.TERRITORY_CODE,
      type: "single_line_text_field",
      value: data.territoryCode,
    });
  }

  if (data.territoryName) {
    metafields.push({
      namespace: METAFIELD_NAMESPACE,
      key: ORDER_METAFIELD_KEYS.TERRITORY_NAME,
      type: "single_line_text_field",
      value: data.territoryName,
    });
  }

  if (data.salesRepExternalId) {
    metafields.push({
      namespace: METAFIELD_NAMESPACE,
      key: ORDER_METAFIELD_KEYS.SALES_REP_EXTERNAL_ID,
      type: "single_line_text_field",
      value: data.salesRepExternalId,
    });
  }

  if (data.salesRepName) {
    metafields.push({
      namespace: METAFIELD_NAMESPACE,
      key: ORDER_METAFIELD_KEYS.SALES_REP_NAME,
      type: "single_line_text_field",
      value: data.salesRepName,
    });
  }

  return metafields;
}

/**
 * Set metafields on an existing Shopify order.
 * Use this when you need to update metafields after order creation.
 */
export async function setOrderMetafields(
  admin: ShopifyAdmin,
  orderGid: string,
  data: OrderMetafieldData
): Promise<{ success: boolean; error?: string }> {
  const metafields = buildOrderMetafields(data);

  if (metafields.length === 0) {
    return { success: true }; // Nothing to set
  }

  try {
    const metafieldsInput = metafields.map(mf => ({
      ownerId: orderGid,
      namespace: mf.namespace,
      key: mf.key,
      type: mf.type,
      value: mf.value,
    }));

    const response = await admin.graphql(ORDER_METAFIELDS_SET_MUTATION, {
      variables: { metafields: metafieldsInput },
    });

    const result = await response.json() as {
      data?: {
        metafieldsSet?: {
          metafields?: Array<{ id: string; namespace: string; key: string }>;
          userErrors?: Array<{ field: string[]; message: string }>;
        };
      };
    };

    const userErrors = result.data?.metafieldsSet?.userErrors;
    if (userErrors && userErrors.length > 0) {
      console.error("[Metafield] Set errors:", userErrors);
      return { success: false, error: userErrors.map(e => e.message).join(", ") };
    }

    console.log(`[Metafield] Set ${metafields.length} metafields on order ${orderGid}`);
    return { success: true };
  } catch (error) {
    console.error("[Metafield] Error setting metafields:", error);
    return { success: false, error: "Failed to set order metafields" };
  }
}

/**
 * Collect metafield data for an order from the database.
 * This fetches the territory and sales rep data needed for metafields.
 */
export async function collectOrderMetafieldData(orderId: string): Promise<OrderMetafieldData> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      salesRep: {
        select: {
          firstName: true,
          lastName: true,
          externalId: true,
        },
      },
      shippingLocation: {
        include: {
          territory: {
            select: {
              name: true,
              code: true,
            },
          },
        },
      },
      company: {
        include: {
          territory: {
            select: {
              name: true,
              code: true,
            },
          },
        },
      },
    },
  });

  if (!order) {
    return {};
  }

  // Get territory from shipping location first, fall back to company territory
  const territory = order.shippingLocation?.territory || order.company?.territory;

  return {
    territoryCode: territory?.code || null,
    territoryName: territory?.name || null,
    salesRepExternalId: order.salesRep?.externalId || null,
    salesRepName: order.salesRep
      ? `${order.salesRep.firstName} ${order.salesRep.lastName}`.trim()
      : null,
  };
}
