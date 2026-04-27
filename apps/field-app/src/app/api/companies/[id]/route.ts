import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { getAuthContext } from '@/lib/auth';
import { proxyToShopifyApp } from '@/services/shopifyAppClient';
import type { ApiError } from '@/types';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { shopId, repId, role } = await getAuthContext();
    const { id } = await params;

    const company = await prisma.company.findFirst({
      where: { id, shopId },
      include: {
        territory: true,
        assignedRep: true,
        contacts: {
          orderBy: [{ isPrimary: 'desc' }, { firstName: 'asc' }],
        },
        locations: {
          orderBy: [{ isPrimary: 'desc' }, { name: 'asc' }],
        },
      },
    });

    if (!company) {
      return NextResponse.json<ApiError>(
        { data: null, error: { code: 'NOT_FOUND', message: 'Company not found' } },
        { status: 404 }
      );
    }

    // For reps, verify access to company
    if (role === 'REP') {
      const hasAccess = company.assignedRepId === repId || (
        company.territoryId &&
        await prisma.repTerritory.findFirst({
          where: { repId, territoryId: company.territoryId },
        })
      );

      if (!hasAccess) {
        return NextResponse.json<ApiError>(
          { data: null, error: { code: 'FORBIDDEN', message: 'Access denied to this company' } },
          { status: 403 }
        );
      }
    }

    const result = {
      id: company.id,
      shopId: company.shopId,
      shopifyCompanyId: company.shopifyCompanyId,
      name: company.name,
      accountNumber: company.accountNumber,
      paymentTerms: company.paymentTerms,
      territoryId: company.territoryId,
      assignedRepId: company.assignedRepId,
      syncStatus: company.syncStatus,
      lastSyncedAt: company.lastSyncedAt,
      isActive: company.isActive,
      createdAt: company.createdAt,
      updatedAt: company.updatedAt,
      territory: company.territory,
      assignedRep: company.assignedRep,
      contacts: company.contacts.map((c) => ({
        id: c.id,
        firstName: c.firstName,
        lastName: c.lastName,
        email: c.email,
        phone: c.phone,
        title: c.title,
        isPrimary: c.isPrimary,
      })),
      locations: company.locations.map((l) => ({
        id: l.id,
        name: l.name,
        address1: l.address1,
        address2: l.address2,
        city: l.city,
        province: l.province,
        provinceCode: l.provinceCode,
        zipcode: l.zipcode,
        country: l.country,
        phone: l.phone,
        isPrimary: l.isPrimary,
        isShippingAddress: l.isShippingAddress,
        isBillingAddress: l.isBillingAddress,
      })),
    };

    return NextResponse.json({ data: result, error: null });
  } catch (error) {
    console.error('Error fetching company:', error);
    return NextResponse.json<ApiError>(
      { data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch company' } },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/companies/:id — proxy.
 */
export async function PUT(request: Request, { params }: RouteParams) {
  const auth = await getAuthContext();
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  return proxyToShopifyApp(auth, `/api/internal/companies/${id}`, { method: 'PUT', body });
}
