import { NextResponse } from 'next/server';
import { Prisma } from '@field-sales/database';
import { prisma } from '@/lib/db/prisma';
import { getAuthContext } from '@/lib/auth';
import { proxyToShopifyApp } from '@/services/shopifyAppClient';
import type { ApiError, CompanyListItem, PaginatedResponse } from '@/types';

/**
 * GET /api/companies — read directly from DB (rep scoping handled here).
 */
export async function GET(request: Request) {
  try {
    const { shopId, repId, role } = await getAuthContext();
    const { searchParams } = new URL(request.url);

    const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
    const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get('pageSize') || '20')));
    const query = searchParams.get('query') || '';
    const territoryId = searchParams.get('territoryId') || null;
    const assignedRepId = searchParams.get('assignedRepId') || null;
    const myCompaniesOnly = searchParams.get('myCompaniesOnly') === 'true';

    const skip = (page - 1) * pageSize;

    const where: Prisma.CompanyWhereInput = {
      shopId,
      isActive: true,
    };

    if (role === 'REP' || myCompaniesOnly) {
      const repTerritories = await prisma.repTerritory.findMany({
        where: { repId },
        select: { territoryId: true },
      });
      const repTerritoryIds = repTerritories.map((rt) => rt.territoryId);

      where.OR = [
        { territoryId: { in: repTerritoryIds } },
        { assignedRepId: repId },
      ];
    }

    if (territoryId) where.territoryId = territoryId;
    if (assignedRepId) where.assignedRepId = assignedRepId;
    if (query) {
      where.AND = [
        {
          OR: [
            { name: { contains: query, mode: 'insensitive' } },
            { accountNumber: { contains: query, mode: 'insensitive' } },
          ],
        },
      ];
    }

    const [companies, totalItems] = await Promise.all([
      prisma.company.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { name: 'asc' },
        include: {
          territory: { select: { name: true } },
          assignedRep: { select: { firstName: true, lastName: true } },
          _count: { select: { locations: true, contacts: true } },
        },
      }),
      prisma.company.count({ where }),
    ]);

    const items: CompanyListItem[] = companies.map((c) => ({
      id: c.id,
      shopifyCompanyId: c.shopifyCompanyId,
      name: c.name,
      accountNumber: c.accountNumber,
      locationCount: c._count.locations,
      contactCount: c._count.contacts,
      territoryName: c.territory?.name || null,
      assignedRepName: c.assignedRep ? `${c.assignedRep.firstName} ${c.assignedRep.lastName}` : null,
      isShopifyManaged: c.shopifyCompanyId !== null,
    }));

    const totalPages = Math.ceil(totalItems / pageSize);
    const response: PaginatedResponse<CompanyListItem> = {
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
    console.error('Error fetching companies:', error);
    return NextResponse.json<ApiError>(
      { data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch companies' } },
      { status: 500 }
    );
  }
}

/**
 * POST /api/companies — proxy.
 */
export async function POST(request: Request) {
  const auth = await getAuthContext();
  const body = await request.json().catch(() => ({}));
  return proxyToShopifyApp(auth, '/api/internal/companies', { method: 'POST', body });
}
