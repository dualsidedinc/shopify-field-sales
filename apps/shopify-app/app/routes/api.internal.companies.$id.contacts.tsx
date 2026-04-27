import type { ActionFunctionArgs } from "react-router";
import prisma from "../db.server";
import { requireInternalAuth } from "../lib/internal-auth.server";

interface CreateContactRequest {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string | null;
  title?: string | null;
  isPrimary?: boolean;
  canPlaceOrders?: boolean;
}

/**
 * POST /api/internal/companies/:id/contacts — add a contact to an internal company.
 */
export const action = async ({ request, params }: ActionFunctionArgs) => {
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

  const companyId = params.id;
  if (!companyId) {
    return jsonResponse(400, { data: null, error: { code: "VALIDATION_ERROR", message: "Company id required" } });
  }

  const body = (await request.json().catch(() => ({}))) as CreateContactRequest;

  const company = await prisma.company.findFirst({ where: { id: companyId, shopId: auth.shopId } });
  if (!company) {
    return jsonResponse(404, { data: null, error: { code: "NOT_FOUND", message: "Company not found" } });
  }
  if (company.shopifyCompanyId) {
    return jsonResponse(403, {
      data: null,
      error: { code: "FORBIDDEN", message: "Contacts for Shopify-managed companies are managed in Shopify Admin" },
    });
  }

  if (!body.firstName?.trim() || !body.lastName?.trim()) {
    return jsonResponse(400, { data: null, error: { code: "VALIDATION_ERROR", message: "First name and last name are required" } });
  }
  if (!body.email?.trim()) {
    return jsonResponse(400, { data: null, error: { code: "VALIDATION_ERROR", message: "Email is required" } });
  }

  const existingContact = await prisma.companyContact.findFirst({
    where: { companyId, email: { equals: body.email.trim().toLowerCase(), mode: "insensitive" } },
  });
  if (existingContact) {
    return jsonResponse(409, {
      data: null,
      error: { code: "CONFLICT", message: "A contact with this email already exists for this company" },
    });
  }

  if (body.isPrimary) {
    await prisma.companyContact.updateMany({
      where: { companyId, isPrimary: true },
      data: { isPrimary: false },
    });
  }

  const existingCount = await prisma.companyContact.count({ where: { companyId } });
  const isPrimary = body.isPrimary || existingCount === 0;

  const contact = await prisma.companyContact.create({
    data: {
      companyId,
      firstName: body.firstName.trim(),
      lastName: body.lastName.trim(),
      email: body.email.trim().toLowerCase(),
      phone: body.phone?.trim() || null,
      title: body.title?.trim() || null,
      isPrimary,
      canPlaceOrders: body.canPlaceOrders ?? true,
    },
  });

  return jsonResponse(201, {
    data: {
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
    },
    error: null,
  });
};

export const loader = () =>
  jsonResponse(405, { data: null, error: { code: "METHOD_NOT_ALLOWED", message: "POST only" } });

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
