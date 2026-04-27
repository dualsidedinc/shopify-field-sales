import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { getAuthContext } from '@/lib/auth';
import { proxyToShopifyApp } from '@/services/shopifyAppClient';
import type {
  ApiError,
  TerritoryListItem,
  PaginatedResponse,
} from '@/types';

/**
 * GET /api/territories — read directly from DB.
 */
export async function GET(request: Request) {
  try {
    const { shopId } = await getAuthContext();
    const { searchParams } = new URL(request.url);

    const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
    const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get('pageSize') || '20')));
    const query = searchParams.get('query') || '';
    const activeOnly = searchParams.get('activeOnly') !== 'false';

    const skip = (page - 1) * pageSize;
    const where = {
      shopId,
      ...(activeOnly && { isActive: true }),
      ...(query && {
        OR: [
          { name: { contains: query, mode: 'insensitive' as const } },
          { description: { contains: query, mode: 'insensitive' as const } },
        ],
      }),
    };

    const [territories, totalItems] = await Promise.all([
      prisma.territory.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { name: 'asc' },
        include: {
          _count: { select: { zipcodes: true, repTerritories: true, companies: true } },
        },
      }),
      prisma.territory.count({ where }),
    ]);

    const items: TerritoryListItem[] = territories.map((t) => ({
      id: t.id,
      name: t.name,
      code: t.code,
      description: t.description,
      isActive: t.isActive,
      zipcodeCount: t._count.zipcodes,
      repCount: t._count.repTerritories,
      companyCount: t._count.companies,
    }));

    const totalPages = Math.ceil(totalItems / pageSize);
    const response: PaginatedResponse<TerritoryListItem> = {
      items,
      pagination: {
        page,
        pageSize,
        totalItems,
        totalPages,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1,
      },
    };

    return NextResponse.json({ data: response, error: null });
  } catch (error) {
    console.error('Error fetching territories:', error);
    return NextResponse.json<ApiError>(
      { data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch territories' } },
      { status: 500 }
    );
  }
}

/**
 * POST /api/territories — proxy.
 */
export async function POST(request: Request) {
  const auth = await getAuthContext();
  const body = await request.json().catch(() => ({}));
  return proxyToShopifyApp(auth, '/api/internal/territories', { method: 'POST', body });
}
