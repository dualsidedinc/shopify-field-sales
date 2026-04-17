import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { getAuthContext, requireRole } from '@/lib/auth';
import type {
  ApiError,
  TerritoryListItem,
  TerritoryWithZipcodes,
  CreateTerritoryRequest,
  PaginatedResponse
} from '@/types';

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
          _count: {
            select: {
              zipcodes: true,
              repTerritories: true,
              companies: true,
            },
          },
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

export async function POST(request: Request) {
  try {
    const { shopId } = await requireRole('ADMIN', 'MANAGER');
    const body = (await request.json()) as CreateTerritoryRequest;

    if (!body.name?.trim()) {
      return NextResponse.json<ApiError>(
        { data: null, error: { code: 'VALIDATION_ERROR', message: 'Territory name is required' } },
        { status: 400 }
      );
    }

    // Check for duplicate name
    const existing = await prisma.territory.findFirst({
      where: {
        shopId,
        name: { equals: body.name.trim(), mode: 'insensitive' },
      },
    });

    if (existing) {
      return NextResponse.json<ApiError>(
        { data: null, error: { code: 'CONFLICT', message: 'A territory with this name already exists' } },
        { status: 409 }
      );
    }

    const territory = await prisma.territory.create({
      data: {
        shopId,
        name: body.name.trim(),
        description: body.description?.trim() || null,
        isActive: true,
        ...(body.zipcodes?.length && {
          zipcodes: {
            create: body.zipcodes.map((zipcode) => ({ zipcode: zipcode.trim() })),
          },
        }),
      },
      include: {
        zipcodes: true,
      },
    });

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

    return NextResponse.json({ data: result, error: null }, { status: 201 });
  } catch (error) {
    console.error('Error creating territory:', error);
    return NextResponse.json<ApiError>(
      { data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to create territory' } },
      { status: 500 }
    );
  }
}
