import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { getAuthContext, requireRole } from '@/lib/auth';
import type { ApiError } from '@/types';

interface RouteParams {
  params: Promise<{ id: string }>;
}

interface UpdateCompanyRequest {
  assignedRepId?: string | null;
  territoryId?: string | null;
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

export async function PUT(request: Request, { params }: RouteParams) {
  try {
    const { shopId } = await requireRole('ADMIN', 'MANAGER');
    const { id } = await params;
    const body = (await request.json()) as UpdateCompanyRequest;

    // Verify company exists
    const company = await prisma.company.findFirst({
      where: { id, shopId },
    });

    if (!company) {
      return NextResponse.json<ApiError>(
        { data: null, error: { code: 'NOT_FOUND', message: 'Company not found' } },
        { status: 404 }
      );
    }

    // Validate assigned rep if provided
    if (body.assignedRepId) {
      const rep = await prisma.salesRep.findFirst({
        where: { id: body.assignedRepId, shopId, isActive: true },
      });

      if (!rep) {
        return NextResponse.json<ApiError>(
          { data: null, error: { code: 'VALIDATION_ERROR', message: 'Invalid rep ID' } },
          { status: 400 }
        );
      }
    }

    // Validate territory if provided
    if (body.territoryId) {
      const territory = await prisma.territory.findFirst({
        where: { id: body.territoryId, shopId, isActive: true },
      });

      if (!territory) {
        return NextResponse.json<ApiError>(
          { data: null, error: { code: 'VALIDATION_ERROR', message: 'Invalid territory ID' } },
          { status: 400 }
        );
      }
    }

    const updated = await prisma.company.update({
      where: { id },
      data: {
        ...(body.assignedRepId !== undefined && { assignedRepId: body.assignedRepId }),
        ...(body.territoryId !== undefined && { territoryId: body.territoryId }),
      },
    });

    return NextResponse.json({ data: updated, error: null });
  } catch (error) {
    console.error('Error updating company:', error);
    return NextResponse.json<ApiError>(
      { data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to update company' } },
      { status: 500 }
    );
  }
}
