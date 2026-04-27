import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { getAuthContext } from '@/lib/auth';
import { proxyToShopifyApp } from '@/services/shopifyAppClient';
import type { ApiError } from '@/types';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/companies/:id/payment-methods — read directly from DB.
 */
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { id: companyId } = await params;
    const { shopId, repId, role } = await getAuthContext();

    const company = await prisma.company.findFirst({
      where: {
        id: companyId,
        shopId,
        ...(role === 'REP'
          ? {
              OR: [
                { assignedRepId: repId },
                { territory: { repTerritories: { some: { repId } } } },
              ],
            }
          : {}),
      },
    });

    if (!company) {
      return NextResponse.json<ApiError>(
        { data: null, error: { code: 'NOT_FOUND', message: 'Company not found' } },
        { status: 404 }
      );
    }

    const paymentMethods = await prisma.paymentMethod.findMany({
      where: { shopId, companyId, isActive: true },
      include: {
        contact: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    });

    const response = paymentMethods.map((pm) => ({
      id: pm.id,
      provider: pm.provider,
      last4: pm.last4,
      brand: pm.brand,
      expiryMonth: pm.expiryMonth,
      expiryYear: pm.expiryYear,
      isDefault: pm.isDefault,
      contactId: pm.contactId,
      contactName: pm.contact ? `${pm.contact.firstName} ${pm.contact.lastName}` : null,
      contactEmail: pm.contact?.email,
      createdAt: pm.createdAt.toISOString(),
    }));

    return NextResponse.json({ data: response, error: null });
  } catch (error) {
    console.error('Error fetching payment methods:', error);
    return NextResponse.json<ApiError>(
      { data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch payment methods' } },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/companies/:id/payment-methods?paymentMethodId=... — proxy.
 */
export async function DELETE(request: Request, { params }: RouteParams) {
  const auth = await getAuthContext();
  const { id } = await params;
  const url = new URL(request.url);
  const qs = url.search; // preserve ?paymentMethodId=...
  return proxyToShopifyApp(
    auth,
    `/api/internal/companies/${id}/payment-methods${qs}`,
    { method: 'DELETE' }
  );
}
