import prisma from "../db.server";

/**
 * Shape matches what field-app API routes have historically returned for
 * order detail responses — the field-app client code is coded against this.
 */
export async function buildOrderDetailResponse(orderId: string, shopId: string) {
  const order = await prisma.order.findFirst({
    where: { id: orderId, shopId },
    include: {
      salesRep: { select: { firstName: true, lastName: true, email: true } },
      company: { select: { name: true, territory: { select: { name: true } } } },
      lineItems: true,
      timelineEvents: { orderBy: { createdAt: "desc" } },
    },
  });

  if (!order) return null;

  return {
    id: order.id,
    orderNumber: order.orderNumber,
    shopifyOrderId: order.shopifyOrderId,
    shopifyOrderNumber: order.shopifyOrderNumber,
    companyId: order.companyId,
    companyName: order.company.name,
    subtotalCents: order.subtotalCents,
    discountCents: order.discountCents,
    shippingCents: order.shippingCents,
    taxCents: order.taxCents,
    totalCents: order.totalCents,
    currency: order.currency,
    status: order.status,
    paymentTerms: order.paymentTerms,
    note: order.note,
    poNumber: order.poNumber,
    placedAt: order.placedAt?.toISOString() || null,
    paidAt: order.paidAt?.toISOString() || null,
    refundedAt: order.refundedAt?.toISOString() || null,
    paidAmountCents: order.paidAmountCents,
    refundedAmountCents: order.refundedAmountCents,
    netPaidCents: order.paidAmountCents - order.refundedAmountCents,
    createdAt: order.createdAt.toISOString(),
    rep: {
      name: `${order.salesRep.firstName} ${order.salesRep.lastName}`,
      email: order.salesRep.email,
    },
    territory: order.company.territory?.name || null,
    lineItems: order.lineItems.map((item) => ({
      id: item.id,
      shopifyProductId: item.shopifyProductId,
      shopifyVariantId: item.shopifyVariantId,
      title: item.title,
      variantTitle: item.variantTitle,
      sku: item.sku,
      imageUrl: item.imageUrl,
      quantity: item.quantity,
      unitPriceCents: item.unitPriceCents,
      discountCents: item.discountCents,
      totalCents: item.totalCents,
      isPromotionItem: item.isPromotionItem,
      promotionId: item.promotionId,
      promotionName: item.promotionName,
    })),
    timelineEvents: order.timelineEvents.map((event) => ({
      id: event.id,
      authorType: event.authorType,
      authorId: event.authorId,
      authorName: event.authorName,
      eventType: event.eventType,
      metadata: event.metadata,
      comment: event.comment,
      createdAt: event.createdAt.toISOString(),
    })),
  };
}
