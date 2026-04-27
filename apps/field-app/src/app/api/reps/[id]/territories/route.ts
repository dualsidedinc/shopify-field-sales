import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { getAuthContext, requireRole } from '@/lib/auth';
import { proxyToShopifyApp } from '@/services/shopifyAppClient';
import type { ApiError, Territory } from '@/types';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/reps/:id/territories — read directly from DB.
 */
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { shopId } = await requireRole('ADMIN', 'MANAGER');
    const { id } = await params;

    const rep = await prisma.salesRep.findFirst({ where: { id, shopId } });
    if (!rep) {
      return NextResponse.json<ApiError>(
        { data: null, error: { code: 'NOT_FOUND', message: 'Rep not found' } },
        { status: 404 }
      );
    }

    const repTerritories = await prisma.repTerritory.findMany({
      where: { repId: id },
      include: { territory: true },
      orderBy: [{ isPrimary: 'desc' }, { territory: { name: 'asc' } }],
    });

    const territories: (Territory & { isPrimary: boolean })[] = repTerritories.map((rt) => ({
      id: rt.territory.id,
      shopId: rt.territory.shopId,
      name: rt.territory.name,
      description: rt.territory.description,
      isActive: rt.territory.isActive,
      createdAt: rt.territory.createdAt,
      updatedAt: rt.territory.updatedAt,
      isPrimary: rt.isPrimary,
    }));

    return NextResponse.json({ data: territories, error: null });
  } catch (error) {
    console.error('Error fetching rep territories:', error);
    if (error instanceof Error && error.message.includes('Access denied')) {
      return NextResponse.json<ApiError>(
        { data: null, error: { code: 'FORBIDDEN', message: error.message } },
        { status: 403 }
      );
    }
    return NextResponse.json<ApiError>(
      { data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch territories' } },
      { status: 500 }
    );
  }
}

/**
 * POST /api/reps/:id/territories — proxy.
 */
export async function POST(request: Request, { params }: RouteParams) {
  const auth = await getAuthContext();
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  return proxyToShopifyApp(auth, `/api/internal/reps/${id}/territories`, { method: 'POST', body });
}
