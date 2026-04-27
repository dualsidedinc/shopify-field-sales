import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { getAuthContext } from '@/lib/auth';
import { proxyToShopifyApp } from '@/services/shopifyAppClient';
import type { ApiError, CompanyContact } from '@/types';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/companies/:id/contacts — read directly from DB.
 */
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { shopId } = await getAuthContext();
    const { id: companyId } = await params;

    const company = await prisma.company.findFirst({
      where: { id: companyId, shopId, isActive: true },
    });
    if (!company) {
      return NextResponse.json<ApiError>(
        { data: null, error: { code: 'NOT_FOUND', message: 'Company not found' } },
        { status: 404 }
      );
    }

    const contacts = await prisma.companyContact.findMany({
      where: { companyId },
      orderBy: [{ isPrimary: 'desc' }, { lastName: 'asc' }, { firstName: 'asc' }],
    });

    const result: CompanyContact[] = contacts.map((contact) => ({
      id: contact.id,
      companyId: contact.companyId,
      shopifyContactId: contact.shopifyContactId,
      shopifyCustomerId: contact.shopifyCustomerId,
      firstName: contact.firstName,
      lastName: contact.lastName,
      email: contact.email,
      phone: contact.phone,
      title: contact.title,
      isPrimary: contact.isPrimary,
      canPlaceOrders: contact.canPlaceOrders,
      createdAt: contact.createdAt,
      updatedAt: contact.updatedAt,
    }));

    return NextResponse.json({ data: result, error: null });
  } catch (error) {
    console.error('Error fetching contacts:', error);
    return NextResponse.json<ApiError>(
      { data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch contacts' } },
      { status: 500 }
    );
  }
}

/**
 * POST /api/companies/:id/contacts — proxy.
 */
export async function POST(request: Request, { params }: RouteParams) {
  const auth = await getAuthContext();
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  return proxyToShopifyApp(auth, `/api/internal/companies/${id}/contacts`, { method: 'POST', body });
}
