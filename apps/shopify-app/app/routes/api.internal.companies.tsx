import type { ActionFunctionArgs } from "react-router";
import prisma from "../db.server";
import type { PaymentTerms } from "@field-sales/database";
import { requireInternalAuth } from "../lib/internal-auth.server";

interface CreateCompanyRequest {
  name: string;
  accountNumber?: string | null;
  paymentTerms?: PaymentTerms;
  territoryId?: string | null;
  assignedRepId?: string | null;
  locations?: Array<{
    name: string;
    isPrimary?: boolean;
    address1?: string | null;
    address2?: string | null;
    city?: string | null;
    province?: string | null;
    provinceCode?: string | null;
    zipcode?: string | null;
    country?: string | null;
    countryCode?: string | null;
    phone?: string | null;
    isShippingAddress?: boolean;
    isBillingAddress?: boolean;
  }>;
  contacts?: Array<{
    firstName: string;
    lastName: string;
    email: string;
    phone?: string | null;
    title?: string | null;
    isPrimary?: boolean;
    canPlaceOrders?: boolean;
  }>;
}

const VALID_TERMS: PaymentTerms[] = ["DUE_ON_ORDER", "NET_15", "NET_30", "NET_45", "NET_60"];

/**
 * POST /api/internal/companies — create an internal company.
 * Only allowed for shops without managed (Shopify-synced) companies.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return jsonResponse(405, { data: null, error: { code: "METHOD_NOT_ALLOWED", message: "POST only" } });
  }

  let auth;
  try {
    auth = await requireInternalAuth(request);
  } catch (res) {
    return res as Response;
  }

  if (auth.role !== "ADMIN" && auth.role !== "MANAGER") {
    return jsonResponse(403, { data: null, error: { code: "FORBIDDEN", message: "Admin or manager required" } });
  }

  const body = (await request.json().catch(() => ({}))) as CreateCompanyRequest;

  const shop = await prisma.shop.findUnique({
    where: { id: auth.shopId },
    select: { hasManagedCompanies: true },
  });
  if (shop?.hasManagedCompanies) {
    return jsonResponse(403, {
      data: null,
      error: { code: "FORBIDDEN", message: "Companies are managed in Shopify Admin for this store" },
    });
  }

  if (!body.name?.trim()) {
    return jsonResponse(400, { data: null, error: { code: "VALIDATION_ERROR", message: "Company name is required" } });
  }

  const existingName = await prisma.company.findFirst({
    where: { shopId: auth.shopId, name: { equals: body.name.trim(), mode: "insensitive" } },
  });
  if (existingName) {
    return jsonResponse(409, { data: null, error: { code: "CONFLICT", message: "A company with this name already exists" } });
  }

  if (body.accountNumber?.trim()) {
    const existingAccount = await prisma.company.findFirst({
      where: { shopId: auth.shopId, accountNumber: { equals: body.accountNumber.trim(), mode: "insensitive" } },
    });
    if (existingAccount) {
      return jsonResponse(409, { data: null, error: { code: "CONFLICT", message: "A company with this account number already exists" } });
    }
  }

  if (body.territoryId) {
    const territory = await prisma.territory.findFirst({
      where: { id: body.territoryId, shopId: auth.shopId, isActive: true },
    });
    if (!territory) {
      return jsonResponse(400, { data: null, error: { code: "VALIDATION_ERROR", message: "Invalid territory ID" } });
    }
  }

  if (body.assignedRepId) {
    const rep = await prisma.salesRep.findFirst({
      where: { id: body.assignedRepId, shopId: auth.shopId, isActive: true },
    });
    if (!rep) {
      return jsonResponse(400, { data: null, error: { code: "VALIDATION_ERROR", message: "Invalid rep ID" } });
    }
  }

  const paymentTerms = body.paymentTerms || "DUE_ON_ORDER";
  if (!VALID_TERMS.includes(paymentTerms)) {
    return jsonResponse(400, { data: null, error: { code: "VALIDATION_ERROR", message: "Invalid payment terms" } });
  }

  const company = await prisma.company.create({
    data: {
      shopId: auth.shopId,
      shopifyCompanyId: null,
      name: body.name.trim(),
      accountNumber: body.accountNumber?.trim() || null,
      paymentTerms,
      territoryId: body.territoryId || null,
      assignedRepId: body.assignedRepId || null,
      syncStatus: "SYNCED",
      isActive: true,
      ...(body.locations?.length && {
        locations: {
          create: body.locations.map((loc, index) => ({
            name: loc.name.trim(),
            isPrimary: loc.isPrimary ?? index === 0,
            address1: loc.address1?.trim() || null,
            address2: loc.address2?.trim() || null,
            city: loc.city?.trim() || null,
            province: loc.province?.trim() || null,
            provinceCode: loc.provinceCode?.trim() || null,
            zipcode: loc.zipcode?.trim() || null,
            country: loc.country?.trim() || "US",
            countryCode: loc.countryCode?.trim() || "US",
            phone: loc.phone?.trim() || null,
            isShippingAddress: loc.isShippingAddress ?? true,
            isBillingAddress: loc.isBillingAddress ?? true,
          })),
        },
      }),
      ...(body.contacts?.length && {
        contacts: {
          create: body.contacts.map((c, index) => ({
            firstName: c.firstName.trim(),
            lastName: c.lastName.trim(),
            email: c.email.trim().toLowerCase(),
            phone: c.phone?.trim() || null,
            title: c.title?.trim() || null,
            isPrimary: c.isPrimary ?? index === 0,
            canPlaceOrders: c.canPlaceOrders ?? true,
          })),
        },
      }),
    },
  });

  return jsonResponse(201, {
    data: {
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
    },
    error: null,
  });
};

export const loader = () =>
  jsonResponse(405, { data: null, error: { code: "METHOD_NOT_ALLOWED", message: "POST only" } });

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
