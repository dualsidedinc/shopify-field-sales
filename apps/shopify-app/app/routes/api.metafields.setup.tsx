import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { ensureOrderMetafieldDefinitions, getMetafieldDefinitions, METAFIELD_NAMESPACE } from "../services/metafield.server";

/**
 * API endpoint to set up metafield definitions for the Field Sales app.
 * This creates the necessary metafield definitions in Shopify for order tracking.
 *
 * POST /api/metafields/setup - Create/ensure all metafield definitions
 * GET /api/metafields/setup - Check existing metafield definitions
 */

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);

  console.log("[Metafield Setup] Starting metafield definition setup");

  const result = await ensureOrderMetafieldDefinitions(admin);

  if (result.success) {
    console.log("[Metafield Setup] Successfully set up metafield definitions");
    return Response.json({ success: true, message: "Metafield definitions created successfully" });
  } else {
    console.error("[Metafield Setup] Failed to set up metafield definitions:", result.errors);
    return Response.json(
      { success: false, errors: result.errors },
      { status: 500 }
    );
  }
};

export const loader = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);

  // Check existing definitions
  const definitions = await getMetafieldDefinitions(admin, "ORDER", METAFIELD_NAMESPACE);

  return Response.json({
    namespace: METAFIELD_NAMESPACE,
    definitions: definitions.map(d => ({
      key: d.key,
      name: d.name,
    })),
    count: definitions.length,
  });
};
