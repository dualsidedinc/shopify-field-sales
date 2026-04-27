import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { getAuthContext } from '@/lib/auth';
import { proxyToShopifyApp } from '@/services/shopifyAppClient';
import type { ApiError } from '@/types';

/**
 * GET /api/orders — list orders for the current rep / shop. Reads stay in
 * the field-app per architectural memo: no Shopify side effects, just a
 * paginated query against the shared DB.
 */
export async function GET(request: Request) {
  try {
    const { shopId, repId, role } = await getAuthContext();
    const { searchParams } = new URL(request.url);

    const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
    const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get('pageSize') || '20')));
    const companyId = searchParams.get('companyId');
    const status = searchParams.get('status');
    const query = searchParams.get('query')?.trim();

    const skip = (page - 1) * pageSize;

    // status param accepts a single value or comma-separated list (e.g.
    // "CANCELLED,REFUNDED" for the unified Cancelled filter).
    type OrderStatusValue = 'DRAFT' | 'AWAITING_REVIEW' | 'PENDING' | 'PAID' | 'CANCELLED' | 'REFUNDED';
    const statusList = status
      ? status.split(',').map((s) => s.trim()).filter(Boolean) as OrderStatusValue[]
      : [];

    const where = {
      shopId,
      deletedAt: null,
      ...(role === 'REP' && { salesRepId: repId }),
      ...(companyId && { companyId }),
      ...(statusList.length > 0 && { status: { in: statusList } }),
      ...(query && {
        OR: [
          { orderNumber: { contains: query, mode: 'insensitive' as const } },
          { shopifyOrderNumber: { contains: query, mode: 'insensitive' as const } },
          { company: { name: { contains: query, mode: 'insensitive' as const } } },
          { poNumber: { contains: query, mode: 'insensitive' as const } },
        ],
      }),
    };

    const [orders, totalItems] = await Promise.all([
      prisma.order.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        include: {
          salesRep: { select: { firstName: true, lastName: true } },
          company: { select: { name: true, accountNumber: true } },
          contact: { select: { firstName: true, lastName: true } },
          shippingLocation: {
            select: { name: true, address1: true, city: true, provinceCode: true, zipcode: true },
          },
        },
      }),
      prisma.order.count({ where }),
    ]);

    const items = orders.map((o) => {
      let locationAddress: string | null = null;
      if (o.shippingLocation) {
        const loc = o.shippingLocation;
        const parts = [loc.address1, loc.city, loc.provinceCode, loc.zipcode].filter(Boolean);
        locationAddress = parts.join(', ') || loc.name;
      }

      return {
        id: o.id,
        orderNumber: o.orderNumber,
        shopifyOrderId: o.shopifyOrderId,
        shopifyOrderNumber: o.shopifyOrderNumber,
        companyId: o.companyId,
        companyName: o.company.name,
        companyAccountNumber: o.company.accountNumber,
        contactName: o.contact ? `${o.contact.firstName} ${o.contact.lastName}` : null,
        locationAddress,
        totalCents: o.totalCents,
        currency: o.currency,
        status: o.status,
        placedAt: o.placedAt,
        createdAt: o.createdAt,
        repName: `${o.salesRep.firstName} ${o.salesRep.lastName}`,
      };
    });

    const totalPages = Math.ceil(totalItems / pageSize);

    return NextResponse.json({
      data: {
        items,
        pagination: {
          page,
          pageSize,
          totalItems,
          totalPages,
          hasNextPage: page < totalPages,
          hasPreviousPage: page > 1,
        },
      },
      error: null,
    });
  } catch (error) {
    console.error('Error fetching orders:', error);
    return NextResponse.json<ApiError>(
      { data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch orders' } },
      { status: 500 }
    );
  }
}

/**
 * POST /api/orders — create a new order. Proxies to shopify-app, which owns
 * promotion evaluation, order numbering, and the approval-threshold-driven
 * status decision.
 */
export async function POST(request: Request) {
  const auth = await getAuthContext();
  const body = await request.json().catch(() => ({}));
  return proxyToShopifyApp(auth, '/api/internal/orders', { method: 'POST', body });
}
