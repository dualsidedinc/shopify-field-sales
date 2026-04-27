import type { ActionFunctionArgs } from "react-router";
import prisma from "../db.server";
import { requireInternalAuth, type RepRole } from "../lib/internal-auth.server";

interface UpdateRepRequest {
  email?: string;
  firstName?: string;
  lastName?: string;
  phone?: string | null;
  role?: RepRole;
  isActive?: boolean;
  passwordHash?: string;
}

/**
 * PUT  /api/internal/reps/:id — update rep
 * DELETE /api/internal/reps/:id — soft delete (deactivate)
 */
export const action = async ({ request, params }: ActionFunctionArgs) => {
  let auth;
  try {
    auth = await requireInternalAuth(request);
  } catch (res) {
    return res as Response;
  }

  if (auth.role !== "ADMIN") {
    return jsonResponse(403, { data: null, error: { code: "FORBIDDEN", message: "Only admins can modify reps" } });
  }

  const repId = params.id;
  if (!repId) {
    return jsonResponse(400, { data: null, error: { code: "VALIDATION_ERROR", message: "Rep id required" } });
  }

  const existing = await prisma.salesRep.findFirst({ where: { id: repId, shopId: auth.shopId } });
  if (!existing) {
    return jsonResponse(404, { data: null, error: { code: "NOT_FOUND", message: "Rep not found" } });
  }

  if (request.method === "DELETE") {
    await prisma.salesRep.update({ where: { id: repId }, data: { isActive: false } });
    return jsonResponse(200, { data: { success: true }, error: null });
  }

  if (request.method !== "PUT") {
    return jsonResponse(405, { data: null, error: { code: "METHOD_NOT_ALLOWED", message: "PUT or DELETE only" } });
  }

  const body = (await request.json().catch(() => ({}))) as UpdateRepRequest;

  // Email collision check on rename
  if (body.email && body.email.toLowerCase() !== existing.email.toLowerCase()) {
    const dup = await prisma.salesRep.findFirst({
      where: {
        shopId: auth.shopId,
        email: { equals: body.email.toLowerCase(), mode: "insensitive" },
        NOT: { id: repId },
      },
    });
    if (dup) {
      return jsonResponse(409, { data: null, error: { code: "CONFLICT", message: "A rep with this email already exists" } });
    }
  }

  const updateData: Record<string, unknown> = {};
  if (body.email !== undefined) updateData.email = body.email.toLowerCase().trim();
  if (body.firstName !== undefined) updateData.firstName = body.firstName.trim();
  if (body.lastName !== undefined) updateData.lastName = body.lastName.trim();
  if (body.phone !== undefined) updateData.phone = body.phone?.trim() || null;
  if (body.role !== undefined) updateData.role = body.role;
  if (body.isActive !== undefined) updateData.isActive = body.isActive;
  if (body.passwordHash) updateData.passwordHash = body.passwordHash;

  const rep = await prisma.salesRep.update({
    where: { id: repId },
    data: updateData,
    include: { repTerritories: { include: { territory: true } } },
  });

  return jsonResponse(200, {
    data: {
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
    },
    error: null,
  });
};

export const loader = () =>
  jsonResponse(405, { data: null, error: { code: "METHOD_NOT_ALLOWED", message: "PUT or DELETE only" } });

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
