import type { ActionFunctionArgs } from "react-router";
import prisma from "../db.server";
import { requireInternalAuth } from "../lib/internal-auth.server";

interface UpdateProfileRequest {
  firstName?: string;
  lastName?: string;
  phone?: string | null;
  // Field-app verifies the current password and hashes the new one before
  // proxying. shopify-app just stores whatever passwordHash is sent.
  passwordHash?: string;
}

/**
 * PUT /api/internal/profile — rep updates their own profile.
 * Acts on the rep identified by the auth context (no path id).
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "PUT") {
    return jsonResponse(405, { data: null, error: { code: "METHOD_NOT_ALLOWED", message: "PUT only" } });
  }

  let auth;
  try {
    auth = await requireInternalAuth(request);
  } catch (res) {
    return res as Response;
  }

  const body = (await request.json().catch(() => ({}))) as UpdateProfileRequest;

  const rep = await prisma.salesRep.findFirst({ where: { id: auth.repId, shopId: auth.shopId } });
  if (!rep) {
    return jsonResponse(404, { data: null, error: { code: "NOT_FOUND", message: "Profile not found" } });
  }

  const updateData: Record<string, unknown> = {};
  if (body.firstName !== undefined) updateData.firstName = body.firstName.trim();
  if (body.lastName !== undefined) updateData.lastName = body.lastName.trim();
  if (body.phone !== undefined) updateData.phone = body.phone?.trim() || null;
  if (body.passwordHash) updateData.passwordHash = body.passwordHash;

  const updated = await prisma.salesRep.update({
    where: { id: auth.repId },
    data: updateData,
  });

  return jsonResponse(200, {
    data: {
      id: updated.id,
      email: updated.email,
      firstName: updated.firstName,
      lastName: updated.lastName,
      phone: updated.phone,
      role: updated.role,
    },
    error: null,
  });
};

export const loader = () =>
  jsonResponse(405, { data: null, error: { code: "METHOD_NOT_ALLOWED", message: "PUT only" } });

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
