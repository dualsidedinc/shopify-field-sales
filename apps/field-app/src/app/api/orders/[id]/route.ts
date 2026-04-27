import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { getAuthContext } from '@/lib/auth';
import { proxyToShopifyApp } from '@/services/shopifyAppClient';
import type { ApiError } from '@/types';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/orders/:id — read directly from the shared DB. Reads can stay in
 * the field-app per architectural memo (no Shopify side effects to coordinate).
 */
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { shopId, repId, role } = await getAuthContext();
    const { id } = await params;

    const order = await prisma.order.findFirst({
      where: {
        id,
        shopId,
        deletedAt: null,
        ...(role === 'REP' && { salesRepId: repId }),
      },
      include: {
        salesRep: { select: { firstName: true, lastName: true, email: true } },
        company: { select: { id: true, name: true, shopifyCompanyId: true, territory: { select: { name: true } } } },
        contact: { select: { id: true, firstName: true, lastName: true, email: true } },
        shippingLocation: { select: { id: true, name: true, address1: true, address2: true, city: true, province: true, zipcode: true, country: true } },
        billingLocation: { select: { id: true, name: true, address1: true, address2: true, city: true, province: true, zipcode: true, country: true } },
        lineItems: true,
        timelineEvents: { orderBy: { createdAt: 'desc' } },
      },
    });

    if (!order) {
      return NextResponse.json<ApiError>(
        { data: null, error: { code: 'NOT_FOUND', message: 'Order not found' } },
        { status: 404 }
      );
    }

    const response = {
      id: order.id,
      orderNumber: order.orderNumber,
      shopifyOrderId: order.shopifyOrderId,
      shopifyOrderNumber: order.shopifyOrderNumber,
      companyId: order.companyId,
      company: {
        id: order.company.id,
        name: order.company.name,
        shopifyCompanyId: order.company.shopifyCompanyId,
      },
      companyName: order.company.name,
      contact: order.contact ? {
        id: order.contact.id,
        firstName: order.contact.firstName,
        lastName: order.contact.lastName,
        email: order.contact.email,
      } : null,
      shippingLocation: order.shippingLocation ? {
        id: order.shippingLocation.id,
        name: order.shippingLocation.name,
        address1: order.shippingLocation.address1,
        address2: order.shippingLocation.address2,
        city: order.shippingLocation.city,
        province: order.shippingLocation.province,
        zipcode: order.shippingLocation.zipcode,
        country: order.shippingLocation.country,
      } : null,
      billingLocation: order.billingLocation ? {
        id: order.billingLocation.id,
        name: order.billingLocation.name,
        address1: order.billingLocation.address1,
        address2: order.billingLocation.address2,
        city: order.billingLocation.city,
        province: order.billingLocation.province,
        zipcode: order.billingLocation.zipcode,
        country: order.billingLocation.country,
      } : null,
      shippingMethodId: order.shippingMethodId,
      appliedPromotionIds: order.appliedPromotionIds,
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

    return NextResponse.json({ data: response, error: null });
  } catch (error) {
    console.error('Error fetching order:', error);
    return NextResponse.json<ApiError>(
      { data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch order' } },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/orders/:id — replace a draft order. Proxies to shopify-app where
 * the promotion engine + state-machine logic lives.
 */
export async function PUT(request: Request, { params }: RouteParams) {
  const auth = await getAuthContext();
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  return proxyToShopifyApp(auth, `/api/internal/orders/${id}`, { method: 'PUT', body });
}

/**
 * DELETE /api/orders/:id — soft delete a draft order. Proxies to shopify-app.
 */
export async function DELETE(_request: Request, { params }: RouteParams) {
  const auth = await getAuthContext();
  const { id } = await params;
  return proxyToShopifyApp(auth, `/api/internal/orders/${id}`, { method: 'DELETE' });
}
