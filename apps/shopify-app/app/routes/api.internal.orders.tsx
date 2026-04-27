import type { ActionFunctionArgs } from "react-router";
import prisma from "../db.server";
import { requireInternalAuth } from "../lib/internal-auth.server";
import {
  evaluatePromotions,
  type CartLineItem,
} from "../services/promotion-eval.server";
import { addTimelineEvent } from "../services/order.server";
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

interface CreateOrderRequest {
  companyId: string;
  contactId?: string;
  shippingLocationId?: string;
  billingLocationId?: string;
  lineItems?: LineItemInput[];
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
  submitForApproval?: boolean;
  comment?: string;
}

/**
 * POST /api/internal/orders
 * Creates a new order on behalf of a sales rep. Owns:
 *  - promotion evaluation (or trusts client free items if present)
 *  - order number generation
 *  - approval-threshold-driven status (DRAFT / AWAITING_REVIEW / PENDING)
 *  - optional auto-submit timeline event
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

  const body = (await request.json().catch(() => ({}))) as CreateOrderRequest;

  if (!body.companyId) {
    return jsonResponse(400, { data: null, error: { code: "VALIDATION_ERROR", message: "Company ID is required" } });
  }
  if (!body.lineItems || body.lineItems.length === 0) {
    return jsonResponse(400, { data: null, error: { code: "VALIDATION_ERROR", message: "At least one line item is required" } });
  }

  const [company, salesRep] = await Promise.all([
    prisma.company.findFirst({ where: { id: body.companyId, shopId: auth.shopId } }),
    prisma.salesRep.findUnique({
      where: { id: auth.repId },
      select: { firstName: true, lastName: true, approvalThresholdCents: true },
    }),
  ]);

  if (!company) {
    return jsonResponse(404, { data: null, error: { code: "NOT_FOUND", message: "Company not found" } });
  }
  if (!salesRep) {
    return jsonResponse(404, { data: null, error: { code: "NOT_FOUND", message: "Sales rep not found" } });
  }

  // Process line items: trust client free items if present, otherwise evaluate
  // promotions server-side.
  const hasFreeItems = body.lineItems.some((item) => item.isFreeItem);

  let finalLineItems: Array<{
    shopifyProductId: string;
    shopifyVariantId: string;
    sku: string | null;
    title: string;
    variantTitle: string | null;
    imageUrl: string | null;
    quantity: number;
    unitPriceCents: number;
    discountCents: number;
    totalCents: number;
    isPromotionItem: boolean;
    promotionId: string | null;
    promotionName: string | null;
  }>;
  let appliedPromotionIds: string[] = body.appliedPromotionIds || [];

  if (hasFreeItems) {
    finalLineItems = body.lineItems.map((item) => ({
      shopifyProductId: item.shopifyProductId,
      shopifyVariantId: item.shopifyVariantId,
      sku: item.sku,
      title: item.title,
      variantTitle: item.variantTitle,
      imageUrl: item.imageUrl || null,
      quantity: item.quantity,
      unitPriceCents: item.unitPriceCents,
      discountCents: item.isFreeItem ? item.unitPriceCents * item.quantity : 0,
      totalCents: item.isFreeItem ? 0 : item.unitPriceCents * item.quantity,
      isPromotionItem: item.isFreeItem || false,
      promotionId: item.promotionId || null,
      promotionName: item.promotionName || null,
    }));
  } else {
    // Look up local variants for engine input
    const shopifyVariantIds = body.lineItems.map((item) => item.shopifyVariantId);
    const localVariants = await prisma.productVariant.findMany({
      where: { shopifyVariantId: { in: shopifyVariantIds }, product: { shopId: auth.shopId } },
      include: { product: { select: { id: true, shopifyProductId: true } } },
    });
    const variantMap = new Map(localVariants.map((v) => [v.shopifyVariantId, v]));

    const promotionLineItems: CartLineItem[] = body.lineItems.map((item) => {
      const local = variantMap.get(item.shopifyVariantId);
      return {
        variantId: local?.id || item.shopifyVariantId,
        shopifyVariantId: item.shopifyVariantId,
        productId: local?.product.id || item.shopifyProductId,
        shopifyProductId: local?.product.shopifyProductId || item.shopifyProductId,
        title: item.title,
        variantTitle: item.variantTitle,
        quantity: item.quantity,
        unitPriceCents: item.unitPriceCents,
      };
    });

    const promoResult = await evaluatePromotions(auth.shopId, promotionLineItems);
    appliedPromotionIds = promoResult.appliedPromotions.map((p) => p.id);

    finalLineItems = promoResult.lineItems.map((item) => {
      const original = body.lineItems!.find((c) => c.shopifyVariantId === item.shopifyVariantId);
      return {
        shopifyProductId: item.shopifyProductId,
        shopifyVariantId: item.shopifyVariantId,
        sku: original?.sku || null,
        title: item.title,
        variantTitle: item.variantTitle,
        imageUrl: original?.imageUrl || null,
        quantity: item.quantity,
        unitPriceCents: item.unitPriceCents,
        discountCents: item.totalDiscountCents,
        totalCents: item.finalPriceCents,
        isPromotionItem: item.isFreeItem || false,
        promotionId: item.promotionId || null,
        promotionName: null,
      };
    });
  }

  // Generate order number (FS-N) — find max existing and increment.
  const existingOrders = await prisma.order.findMany({
    where: { shopId: auth.shopId },
    select: { orderNumber: true },
  });
  let maxNumber = 0;
  for (const o of existingOrders) {
    const match = o.orderNumber?.match(/FS-(\d+)/);
    if (match) {
      const num = parseInt(match[1], 10);
      if (num > maxNumber) maxNumber = num;
    }
  }
  const orderNumber = `FS-${maxNumber + 1}`;

  // Determine status: rep's approval threshold drives whether AWAITING_REVIEW
  // is required when submitting for approval.
  const regularItems = finalLineItems.filter((i) => !i.isPromotionItem);
  const calculatedSubtotal = regularItems.reduce(
    (sum, i) => sum + i.unitPriceCents * i.quantity,
    0
  );
  const subtotalForApproval = body.subtotalCents ?? calculatedSubtotal;
  const needsApproval =
    salesRep.approvalThresholdCents !== null &&
    salesRep.approvalThresholdCents !== undefined &&
    subtotalForApproval >= salesRep.approvalThresholdCents;

  let orderStatus: "DRAFT" | "AWAITING_REVIEW" | "PENDING" = "DRAFT";
  if (body.submitForApproval) {
    orderStatus = needsApproval ? "AWAITING_REVIEW" : "PENDING";
  }

  const order = await prisma.order.create({
    data: {
      shopId: auth.shopId,
      salesRepId: auth.repId,
      companyId: body.companyId,
      contactId: body.contactId || null,
      shippingLocationId: body.shippingLocationId || null,
      billingLocationId: body.billingLocationId || null,
      orderNumber,
      shopifyDraftOrderId: null,
      shopifyOrderId: null,
      shopifyOrderNumber: null,
      subtotalCents: body.subtotalCents ?? calculatedSubtotal,
      discountCents: body.discountCents ?? 0,
      shippingCents: body.shippingCents ?? 0,
      taxCents: body.taxCents ?? 0,
      totalCents: body.totalCents ?? calculatedSubtotal,
      appliedPromotionIds,
      currency: body.currency ?? "USD",
      status: orderStatus,
      paymentTerms: company.paymentTerms,
      note: body.note ?? null,
      poNumber: body.poNumber ?? null,
      shippingMethodId: body.shippingMethodId ?? null,
      placedAt: new Date(),
      lineItems: {
        create: finalLineItems.map((item) => ({
          shopifyProductId: item.shopifyProductId,
          shopifyVariantId: item.shopifyVariantId,
          sku: item.sku,
          title: item.title,
          variantTitle: item.variantTitle,
          imageUrl: item.imageUrl,
          quantity: item.quantity,
          unitPriceCents: item.unitPriceCents,
          discountCents: item.discountCents,
          taxCents: 0,
          totalCents: item.totalCents,
          isPromotionItem: item.isPromotionItem,
          promotionId: item.promotionId,
          promotionName: item.promotionName,
        })),
      },
    },
  });

  // Submit-on-create: record timeline event
  if (body.submitForApproval && (orderStatus === "AWAITING_REVIEW" || orderStatus === "PENDING")) {
    await addTimelineEvent({
      orderId: order.id,
      authorType: "SALES_REP",
      authorId: auth.repId,
      authorName: `${salesRep.firstName} ${salesRep.lastName}`,
      eventType: "submitted",
      comment: body.comment?.trim() || null,
    });
  }

  const data = await buildOrderDetailResponse(order.id, auth.shopId);
  if (!data) {
    return jsonResponse(500, { data: null, error: { code: "INTERNAL_ERROR", message: "Failed to load created order" } });
  }

  return jsonResponse(201, { data, error: null });
};

export const loader = () =>
  jsonResponse(405, { data: null, error: { code: "METHOD_NOT_ALLOWED", message: "POST only" } });

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
