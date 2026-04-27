import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/db/prisma';
import { getAuthContext, hashPassword } from '@/lib/auth';
import { proxyToShopifyApp } from '@/services/shopifyAppClient';
import type { ApiError } from '@/types';

interface UpdateProfileRequest {
  firstName?: string;
  lastName?: string;
  phone?: string | null;
  currentPassword?: string;
  newPassword?: string;
}

/**
 * GET /api/profile — read directly from DB.
 */
export async function GET() {
  try {
    const { shopId, repId } = await getAuthContext();

    const rep = await prisma.salesRep.findFirst({
      where: { id: repId, shopId },
      include: {
        shop: { select: { shopName: true, shopifyDomain: true } },
        repTerritories: {
          include: { territory: { select: { name: true } } },
          where: { territory: { isActive: true } },
        },
        _count: { select: { assignedCompanies: true, orders: true } },
      },
    });

    if (!rep) {
      return NextResponse.json<ApiError>(
        { data: null, error: { code: 'NOT_FOUND', message: 'Profile not found' } },
        { status: 404 }
      );
    }

    return NextResponse.json({
      data: {
        id: rep.id,
        email: rep.email,
        firstName: rep.firstName,
        lastName: rep.lastName,
        phone: rep.phone,
        role: rep.role,
        isActive: rep.isActive,
        createdAt: rep.createdAt.toISOString(),
        shop: { name: rep.shop.shopName, domain: rep.shop.shopifyDomain },
        territories: rep.repTerritories.map((rt) => rt.territory.name),
        stats: {
          assignedCompanies: rep._count.assignedCompanies,
          totalOrders: rep._count.orders,
        },
      },
      error: null,
    });
  } catch (error) {
    console.error('Error fetching profile:', error);
    return NextResponse.json<ApiError>(
      { data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch profile' } },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/profile — proxy. Field-app verifies the current password (its
 * own auth domain) and hashes the new one, then forwards a clean payload to
 * shopify-app.
 */
export async function PUT(request: Request) {
  const auth = await getAuthContext();
  const body = (await request.json().catch(() => ({}))) as UpdateProfileRequest;

  if (body.newPassword) {
    if (!body.currentPassword) {
      return NextResponse.json<ApiError>(
        { data: null, error: { code: 'VALIDATION_ERROR', message: 'Current password is required' } },
        { status: 400 }
      );
    }
    if (body.newPassword.length < 8) {
      return NextResponse.json<ApiError>(
        { data: null, error: { code: 'VALIDATION_ERROR', message: 'New password must be at least 8 characters' } },
        { status: 400 }
      );
    }

    const rep = await prisma.salesRep.findFirst({
      where: { id: auth.repId, shopId: auth.shopId },
      select: { passwordHash: true },
    });
    if (!rep) {
      return NextResponse.json<ApiError>(
        { data: null, error: { code: 'NOT_FOUND', message: 'Profile not found' } },
        { status: 404 }
      );
    }
    if (!rep.passwordHash) {
      return NextResponse.json<ApiError>(
        { data: null, error: { code: 'VALIDATION_ERROR', message: 'Cannot change password — account uses SMS authentication' } },
        { status: 400 }
      );
    }

    const valid = await bcrypt.compare(body.currentPassword, rep.passwordHash);
    if (!valid) {
      return NextResponse.json<ApiError>(
        { data: null, error: { code: 'VALIDATION_ERROR', message: 'Current password is incorrect' } },
        { status: 400 }
      );
    }
  }

  const payload: Record<string, unknown> = {};
  if (body.firstName !== undefined) payload.firstName = body.firstName;
  if (body.lastName !== undefined) payload.lastName = body.lastName;
  if (body.phone !== undefined) payload.phone = body.phone;
  if (body.newPassword) payload.passwordHash = await hashPassword(body.newPassword);

  return proxyToShopifyApp(auth, '/api/internal/profile', { method: 'PUT', body: payload });
}
