import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { getAuthContext, requireRole, hashPassword } from '@/lib/auth';
import { proxyToShopifyApp } from '@/services/shopifyAppClient';
import type { ApiError, SalesRepWithTerritories, UpdateSalesRepRequest } from '@/types';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/reps/:id — read directly from DB.
 */
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { shopId } = await requireRole('ADMIN', 'MANAGER');
    const { id } = await params;

    const rep = await prisma.salesRep.findFirst({
      where: { id, shopId },
      include: { repTerritories: { include: { territory: true } } },
    });

    if (!rep) {
      return NextResponse.json<ApiError>(
        { data: null, error: { code: 'NOT_FOUND', message: 'Rep not found' } },
        { status: 404 }
      );
    }

    const result: SalesRepWithTerritories = {
      id: rep.id,
      shopId: rep.shopId,
      email: rep.email,
      firstName: rep.firstName,
      lastName: rep.lastName,
      phone: rep.phone,
      role: rep.role,
      isActive: rep.isActive,
      createdAt: rep.createdAt,
      updatedAt: rep.updatedAt,
      territories: rep.repTerritories.map((rt) => ({
        id: rt.territory.id,
        shopId: rt.territory.shopId,
        name: rt.territory.name,
        description: rt.territory.description,
        isActive: rt.territory.isActive,
        createdAt: rt.territory.createdAt,
        updatedAt: rt.territory.updatedAt,
      })),
    };

    return NextResponse.json({ data: result, error: null });
  } catch (error) {
    console.error('Error fetching rep:', error);
    if (error instanceof Error && error.message.includes('Access denied')) {
      return NextResponse.json<ApiError>(
        { data: null, error: { code: 'FORBIDDEN', message: error.message } },
        { status: 403 }
      );
    }
    return NextResponse.json<ApiError>(
      { data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch rep' } },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/reps/:id — proxy to shopify-app, hashing password client-side if present.
 */
export async function PUT(request: Request, { params }: RouteParams) {
  const auth = await getAuthContext();
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as UpdateSalesRepRequest;

  if (body.password !== undefined && body.password.length < 8) {
    return NextResponse.json<ApiError>(
      { data: null, error: { code: 'VALIDATION_ERROR', message: 'Password must be at least 8 characters' } },
      { status: 400 }
    );
  }

  const { password, ...rest } = body;
  const payload: Record<string, unknown> = { ...rest };
  if (password) {
    payload.passwordHash = await hashPassword(password);
  }

  return proxyToShopifyApp(auth, `/api/internal/reps/${id}`, { method: 'PUT', body: payload });
}

/**
 * DELETE /api/reps/:id — proxy.
 */
export async function DELETE(_request: Request, { params }: RouteParams) {
  const auth = await getAuthContext();
  const { id } = await params;
  return proxyToShopifyApp(auth, `/api/internal/reps/${id}`, { method: 'DELETE' });
}
