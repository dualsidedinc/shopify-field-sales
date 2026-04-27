import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { getAuthContext } from '@/lib/auth';
import { proxyToShopifyApp } from '@/services/shopifyAppClient';
import type { ApiError, TerritoryWithZipcodes } from '@/types';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/territories/:id — read directly from DB.
 */
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { shopId } = await getAuthContext();
    const { id } = await params;

    const territory = await prisma.territory.findFirst({
      where: { id, shopId },
      include: { zipcodes: true },
    });

    if (!territory) {
      return NextResponse.json<ApiError>(
        { data: null, error: { code: 'NOT_FOUND', message: 'Territory not found' } },
        { status: 404 }
      );
    }

    const result: TerritoryWithZipcodes = {
      id: territory.id,
      shopId: territory.shopId,
      name: territory.name,
      description: territory.description,
      isActive: territory.isActive,
      createdAt: territory.createdAt,
      updatedAt: territory.updatedAt,
      zipcodes: territory.zipcodes.map((z) => z.zipcode),
    };

    return NextResponse.json({ data: result, error: null });
  } catch (error) {
    console.error('Error fetching territory:', error);
    return NextResponse.json<ApiError>(
      { data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch territory' } },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/territories/:id — proxy.
 */
export async function PUT(request: Request, { params }: RouteParams) {
  const auth = await getAuthContext();
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  return proxyToShopifyApp(auth, `/api/internal/territories/${id}`, { method: 'PUT', body });
}

/**
 * DELETE /api/territories/:id — proxy.
 */
export async function DELETE(_request: Request, { params }: RouteParams) {
  const auth = await getAuthContext();
  const { id } = await params;
  return proxyToShopifyApp(auth, `/api/internal/territories/${id}`, { method: 'DELETE' });
}
