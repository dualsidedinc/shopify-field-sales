import { NextResponse } from 'next/server';
import { Prisma } from '@field-sales/database';
import { prisma } from '@/lib/db/prisma';
import { getAuthContext, requireRole, hashPassword } from '@/lib/auth';
import { proxyToShopifyApp } from '@/services/shopifyAppClient';
import type {
  ApiError,
  SalesRepListItem,
  CreateSalesRepRequest,
  PaginatedResponse,
} from '@/types';

/**
 * GET /api/reps — list reps. Read-only DB query stays in field-app.
 */
export async function GET(request: Request) {
  try {
    const { shopId } = await requireRole('ADMIN', 'MANAGER');
    const { searchParams } = new URL(request.url);

    const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
    const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get('pageSize') || '20')));
    const query = searchParams.get('query') || '';
    const activeOnly = searchParams.get('activeOnly') !== 'false';

    const skip = (page - 1) * pageSize;

    const where: Prisma.SalesRepWhereInput = {
      shopId,
      ...(activeOnly && { isActive: true }),
      ...(query && {
        OR: [
          { email: { contains: query, mode: 'insensitive' } },
          { firstName: { contains: query, mode: 'insensitive' } },
          { lastName: { contains: query, mode: 'insensitive' } },
        ],
      }),
    };

    const [reps, totalItems] = await Promise.all([
      prisma.salesRep.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
        include: {
          _count: { select: { repTerritories: true, assignedCompanies: true } },
        },
      }),
      prisma.salesRep.count({ where }),
    ]);

    const items: SalesRepListItem[] = reps.map((r) => ({
      id: r.id,
      email: r.email,
      firstName: r.firstName,
      lastName: r.lastName,
      role: r.role,
      isActive: r.isActive,
      territoryCount: r._count.repTerritories,
      companyCount: r._count.assignedCompanies,
    }));

    const totalPages = Math.ceil(totalItems / pageSize);
    const response: PaginatedResponse<SalesRepListItem> = {
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
    console.error('Error fetching reps:', error);
    if (error instanceof Error && error.message.includes('Access denied')) {
      return NextResponse.json<ApiError>(
        { data: null, error: { code: 'FORBIDDEN', message: error.message } },
        { status: 403 }
      );
    }
    return NextResponse.json<ApiError>(
      { data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch reps' } },
      { status: 500 }
    );
  }
}

/**
 * POST /api/reps — proxy to shopify-app. Field-app hashes the password
 * before forwarding so bcryptjs stays out of shopify-app.
 */
export async function POST(request: Request) {
  const auth = await getAuthContext();
  const body = (await request.json().catch(() => ({}))) as CreateSalesRepRequest;

  if (!body.password || body.password.length < 8) {
    return NextResponse.json<ApiError>(
      { data: null, error: { code: 'VALIDATION_ERROR', message: 'Password must be at least 8 characters' } },
      { status: 400 }
    );
  }

  const passwordHash = await hashPassword(body.password);
  const { password: _password, ...rest } = body;
  void _password;

  return proxyToShopifyApp(auth, '/api/internal/reps', {
    method: 'POST',
    body: { ...rest, passwordHash },
  });
}
