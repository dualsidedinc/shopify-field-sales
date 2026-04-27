import type { ActionFunctionArgs } from "react-router";
import prisma from "../db.server";
import { requireInternalAuth } from "../lib/internal-auth.server";
import {
  evaluatePromotions,
  type CartLineItem,
} from "../services/promotion-eval.server";
import { buildOrderDetailResponse } from "../services/order-detail-response.server";

interface LineItemInput {
  shopifyProductId: string;
  shopifyVariantId: string;
  sku: string | null;
  title: string;
  variantTitle: string | null;
  imageUrl?: string | null;
  quantity: number;
  unitPriceCents: number;
  isFreeItem?: boolean;
  promotionId?: string | null;
  promotionName?: string | null;
}

interface ReplaceOrderRequest {
  contactId?: string;
  shippingLocationId?: string;
  billingLocationId?: string;
  lineItems: LineItemInput[];
  appliedPromotionIds?: string[];
  shippingMethodId?: string;
  note?: string | null;
  poNumber?: string | null;
  subtotalCents?: number;
  discountCents?: number;
  shippingCents?: number;
  taxCents?: number;
  totalCents?: number;
  currency?: string;
}

export const action = async ({ request, params }: ActionFunctionArgs) => {
  let auth;
  try {
    auth = await requireInternalAuth(request);
  } catch (res) {
    return res as Response;
  }

  const orderId = params.id;
  if (!orderId) {
    return jsonResponse(400, { data: null, error: { code: "VALIDATION_ERROR", message: "Order id required" } });
  }

  switch (request.method) {
    case "PUT":
      return handleReplace(request, auth, orderId);
    case "DELETE":
      return handleDelete(auth, orderId);
    default:
      return jsonResponse(405, { data: null, error: { code: "METHOD_NOT_ALLOWED", message: "PUT or DELETE only" } });
  }
};

export const loader = () =>
  jsonResponse(405, { data: null, error: { code: "METHOD_NOT_ALLOWED", message: "PUT or DELETE only" } });

// ===========================================================================
// PUT /api/internal/orders/:id — full replace of a draft order
// ===========================================================================

async function handleReplace(
  request: Request,
  auth: { shopId: string; repId: string; role: string },
  orderId: string
): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as ReplaceOrderRequest;

  const order = await prisma.order.findFirst({
    where: {
      id: orderId,
      shopId: auth.shopId,
      deletedAt: null,
      ...(auth.role === "REP" && { salesRepId: auth.repId }),
    },
  });

  if (!order) {
    return jsonResponse(404, { data: null, error: { code: "NOT_FOUND", message: "Order not found" } });
  }
  if (order.status !== "DRAFT") {
    return jsonResponse(400, { data: null, error: { code: "VALIDATION_ERROR", message: "Only DRAFT orders can be edited" } });
  }
  if (!body.lineItems || body.lineItems.length === 0) {
    return jsonResponse(400, { data: null, error: { code: "VALIDATION_ERROR", message: "Line items are required" } });
  }

  // Drop client free items before re-evaluating — they're engine output, not
  // input. (Bug fixed earlier: passing them back caused duplicate gifts.)
  const purchasedItems = body.lineItems.filter((item) => !item.isFreeItem);

  const promotionLineItems: CartLineItem[] = purchasedItems.map((item) => ({
    variantId: item.shopifyVariantId,
    shopifyVariantId: item.shopifyVariantId,
    productId: item.shopifyProductId,
    shopifyProductId: item.shopifyProductId,
    title: item.title,
    variantTitle: item.variantTitle,
    quantity: item.quantity,
    unitPriceCents: item.unitPriceCents,
  }));

  const promoResult = await evaluatePromotions(auth.shopId, promotionLineItems);

  await prisma.$transaction(async (tx) => {
    await tx.orderLineItem.deleteMany({ where: { orderId: order.id } });

    await tx.orderLineItem.createMany({
      data: promoResult.lineItems.map((item) => {
        const original = body.lineItems.find((li) => li.shopifyVariantId === item.shopifyVariantId);
        return {
          orderId: order.id,
          shopifyProductId: item.shopifyProductId,
          shopifyVariantId: item.shopifyVariantId,
          sku: original?.sku || null,
          title: item.title,
          variantTitle: item.variantTitle,
          imageUrl: original?.imageUrl || null,
          quantity: item.quantity,
          unitPriceCents: item.unitPriceCents,
          discountCents: item.totalDiscountCents,
          taxCents: 0,
          totalCents: item.finalPriceCents,
          isPromotionItem: item.isFreeItem || false,
          promotionId: item.promotionId || null,
          promotionName: null,
        };
      }),
    });

    await tx.order.update({
      where: { id: order.id },
      data: {
        contactId: body.contactId || null,
        shippingLocationId: body.shippingLocationId || null,
        billingLocationId: body.billingLocationId || null,
        subtotalCents: body.subtotalCents ?? promoResult.subtotalCents,
        discountCents: body.discountCents ?? promoResult.orderDiscountCents,
        shippingCents: body.shippingCents ?? 0,
        taxCents: body.taxCents ?? 0,
        totalCents: body.totalCents ?? promoResult.finalTotalCents,
        appliedPromotionIds:
          body.appliedPromotionIds ?? promoResult.appliedPromotions.map((p) => p.id),
        currency: body.currency ?? "USD",
        note: body.note ?? null,
        poNumber: body.poNumber ?? null,
        shippingMethodId: body.shippingMethodId ?? null,
      },
    });
  });

  const data = await buildOrderDetailResponse(orderId, auth.shopId);
  if (!data) {
    return jsonResponse(500, { data: null, error: { code: "INTERNAL_ERROR", message: "Failed to load updated order" } });
  }
  return jsonResponse(200, { data, error: null });
}

// ===========================================================================
// DELETE /api/internal/orders/:id — soft delete
// ===========================================================================

async function handleDelete(
  auth: { shopId: string; repId: string; role: string },
  orderId: string
): Promise<Response> {
  const order = await prisma.order.findFirst({
    where: {
      id: orderId,
      shopId: auth.shopId,
      deletedAt: null,
      ...(auth.role === "REP" && { salesRepId: auth.repId }),
    },
    include: { salesRep: { select: { firstName: true, lastName: true } } },
  });

  if (!order) {
    return jsonResponse(404, { data: null, error: { code: "NOT_FOUND", message: "Order not found" } });
  }
  if (order.shopifyOrderId) {
    return jsonResponse(400, {
      data: null,
      error: { code: "VALIDATION_ERROR", message: "Cannot delete order that is already in Shopify. Cancel in Shopify instead." },
    });
  }
  if (order.status !== "DRAFT" && order.status !== "AWAITING_REVIEW") {
    return jsonResponse(400, {
      data: null,
      error: { code: "VALIDATION_ERROR", message: "Only DRAFT or AWAITING_REVIEW orders can be deleted" },
    });
  }

  const previousStatus = order.status;
  const now = new Date();
  const authorName = `${order.salesRep.firstName} ${order.salesRep.lastName}`;

  await prisma.$transaction([
    prisma.order.update({ where: { id: order.id }, data: { deletedAt: now } }),
    prisma.orderTimelineEvent.create({
      data: {
        orderId: order.id,
        authorType: auth.role === "REP" ? "SALES_REP" : "ADMIN",
        authorId: auth.repId,
        authorName,
        eventType: "deleted",
        metadata: { previousStatus },
        createdAt: now,
      },
    }),
  ]);

  return jsonResponse(200, { data: { success: true }, error: null });
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
