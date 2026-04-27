import type { ActionFunctionArgs } from "react-router";
import prisma from "../db.server";
import { unauthenticated } from "../shopify.server";
import { requireInternalAuth } from "../lib/internal-auth.server";

interface TaxCalculateRequest {
  lineItems: Array<{
    shopifyVariantId?: string | null;
    title: string;
    quantity: number;
    unitPriceCents: number;
  }>;
  shippingAddress?: {
    address1?: string | null;
    city?: string | null;
    province?: string | null;
    zip?: string | null;
    countryCode?: string;
  } | null;
  customerId?: string | null;
  shippingCents?: number;
}

interface TaxLine {
  title: string;
  rate: number;
  amountCents: number;
}

const DRAFT_ORDER_CALCULATE_MUTATION = `#graphql
  mutation DraftOrderCalculate($input: DraftOrderInput!) {
    draftOrderCalculate(input: $input) {
      calculatedDraftOrder {
        totalTax
        taxLines {
          title
          rate
          priceSet {
            shopMoney {
              amount
              currencyCode
            }
          }
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

function toGid(type: string, id: string | number): string {
  if (typeof id === "string" && id.startsWith("gid://")) return id;
  return `gid://shopify/${type}/${id}`;
}

/**
 * POST /api/internal/tax/calculate
 * Runs Shopify's draftOrderCalculate to estimate tax without persisting a
 * draft order. Used by the field-app on the order edit screen.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return jsonResponse(405, { data: null, error: { code: "METHOD_NOT_ALLOWED", message: "POST only" } });
  }

  let auth;
  try {
    auth = await requireInternalAuth(request);
  } catch (res) {
    return res as Response;
  }

  const body = (await request.json().catch(() => ({}))) as TaxCalculateRequest;
  const { lineItems, shippingAddress, customerId, shippingCents } = body;

  if (!lineItems || lineItems.length === 0) {
    return jsonResponse(400, { data: null, error: { code: "BAD_REQUEST", message: "No line items provided" } });
  }

  const shop = await prisma.shop.findUnique({
    where: { id: auth.shopId },
    select: { shopifyDomain: true },
  });
  if (!shop) {
    return jsonResponse(404, { data: null, error: { code: "NOT_FOUND", message: "Shop not found" } });
  }

  const input: Record<string, unknown> = {
    lineItems: lineItems.map((li) => ({
      ...(li.shopifyVariantId && { variantId: toGid("ProductVariant", li.shopifyVariantId) }),
      title: li.title,
      quantity: li.quantity,
      originalUnitPrice: (li.unitPriceCents / 100).toFixed(2),
    })),
  };

  if (shippingAddress) {
    input.shippingAddress = {
      address1: shippingAddress.address1 || "",
      city: shippingAddress.city || "",
      province: shippingAddress.province || "",
      zip: shippingAddress.zip || "",
      country: shippingAddress.countryCode || "US",
    };
  }
  if (customerId) {
    input.purchasingEntity = { customerId: toGid("Customer", customerId) };
  }
  if (shippingCents !== undefined && shippingCents > 0) {
    input.shippingLine = { title: "Shipping", price: (shippingCents / 100).toFixed(2) };
  }

  try {
    const { admin } = await unauthenticated.admin(shop.shopifyDomain);
    const response = await admin.graphql(DRAFT_ORDER_CALCULATE_MUTATION, {
      variables: { input },
    });
    const result = (await response.json()) as {
      data?: {
        draftOrderCalculate?: {
          calculatedDraftOrder?: {
            totalTax: string;
            taxLines: Array<{
              title: string;
              rate: number;
              priceSet: { shopMoney: { amount: string; currencyCode: string } };
            }>;
          };
          userErrors?: Array<{ field: string[]; message: string }>;
        };
      };
    };

    const userErrors = result.data?.draftOrderCalculate?.userErrors;
    if (userErrors?.length) {
      return jsonResponse(400, {
        data: null,
        error: { code: "SHOPIFY_ERROR", message: userErrors.map((e) => e.message).join(", ") },
      });
    }

    const calc = result.data?.draftOrderCalculate?.calculatedDraftOrder;
    if (!calc) {
      return jsonResponse(500, { data: null, error: { code: "SHOPIFY_ERROR", message: "Failed to calculate taxes" } });
    }

    const taxCents = Math.round(parseFloat(calc.totalTax) * 100);
    const taxLines: TaxLine[] = calc.taxLines.map((tl) => ({
      title: tl.title,
      rate: tl.rate,
      amountCents: Math.round(parseFloat(tl.priceSet.shopMoney.amount) * 100),
    }));

    return jsonResponse(200, { data: { taxCents, taxLines }, error: null });
  } catch (err) {
    console.error("[Internal API] Tax calculate failed:", err);
    return jsonResponse(500, { data: null, error: { code: "INTERNAL_ERROR", message: "Failed to calculate tax" } });
  }
};

export const loader = () =>
  jsonResponse(405, { data: null, error: { code: "METHOD_NOT_ALLOWED", message: "POST only" } });

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
