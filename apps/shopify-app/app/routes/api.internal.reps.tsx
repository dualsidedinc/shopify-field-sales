import type { ActionFunctionArgs } from "react-router";
import prisma from "../db.server";
import { requireInternalAuth } from "../lib/internal-auth.server";

interface CreateRepRequest {
  email: string;
  firstName: string;
  lastName: string;
  phone?: string | null;
  role?: "REP" | "MANAGER" | "ADMIN";
  passwordHash: string;
}

/**
 * POST /api/internal/reps — create a sales rep.
 * passwordHash is computed by field-app (it owns the field-app login flow);
 * shopify-app just stores it. This keeps bcryptjs in field-app only.
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

  if (auth.role !== "ADMIN") {
    return jsonResponse(403, { data: null, error: { code: "FORBIDDEN", message: "Only admins can create reps" } });
  }

  const body = (await request.json().catch(() => ({}))) as CreateRepRequest;

  if (!body.email?.trim() || !body.firstName?.trim() || !body.lastName?.trim()) {
    return jsonResponse(400, { data: null, error: { code: "VALIDATION_ERROR", message: "Email, first name, and last name are required" } });
  }
  if (!body.passwordHash) {
    return jsonResponse(400, { data: null, error: { code: "VALIDATION_ERROR", message: "passwordHash is required" } });
  }

  const existing = await prisma.salesRep.findFirst({
    where: { shopId: auth.shopId, email: { equals: body.email.toLowerCase(), mode: "insensitive" } },
  });
  if (existing) {
    return jsonResponse(409, { data: null, error: { code: "CONFLICT", message: "A rep with this email already exists" } });
  }

  const rep = await prisma.salesRep.create({
    data: {
      shopId: auth.shopId,
      email: body.email.toLowerCase().trim(),
      firstName: body.firstName.trim(),
      lastName: body.lastName.trim(),
      phone: body.phone?.trim() || null,
      role: body.role || "REP",
      passwordHash: body.passwordHash,
      isActive: true,
      activatedAt: new Date(),
    },
  });

  return jsonResponse(201, {
    data: {
      id: rep.id,
      email: rep.email,
      firstName: rep.firstName,
      lastName: rep.lastName,
      role: rep.role,
      isActive: rep.isActive,
      territoryCount: 0,
      companyCount: 0,
    },
    error: null,
  });
};

export const loader = () =>
  jsonResponse(405, { data: null, error: { code: "METHOD_NOT_ALLOWED", message: "POST only" } });

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
