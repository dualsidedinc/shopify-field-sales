import type { ActionFunctionArgs } from "react-router";
import prisma from "../db.server";
import { requireInternalAuth } from "../lib/internal-auth.server";

interface AssignTerritoryRequest {
  territoryId: string;
  isPrimary?: boolean;
}

/**
 * POST /api/internal/reps/:id/territories — assign a territory to a rep.
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

  const repId = params.id;
  if (!repId) {
    return jsonResponse(400, { data: null, error: { code: "VALIDATION_ERROR", message: "Rep id required" } });
  }

  const body = (await request.json().catch(() => ({}))) as AssignTerritoryRequest;
  if (!body.territoryId) {
    return jsonResponse(400, { data: null, error: { code: "VALIDATION_ERROR", message: "territoryId is required" } });
  }

  const [rep, territory] = await Promise.all([
    prisma.salesRep.findFirst({ where: { id: repId, shopId: auth.shopId } }),
    prisma.territory.findFirst({ where: { id: body.territoryId, shopId: auth.shopId, isActive: true } }),
  ]);

  if (!rep) {
    return jsonResponse(404, { data: null, error: { code: "NOT_FOUND", message: "Rep not found" } });
  }
  if (!territory) {
    return jsonResponse(404, { data: null, error: { code: "NOT_FOUND", message: "Territory not found" } });
  }

  const existing = await prisma.repTerritory.findFirst({
    where: { repId, territoryId: body.territoryId },
  });
  if (existing) {
    return jsonResponse(409, { data: null, error: { code: "CONFLICT", message: "Territory already assigned to this rep" } });
  }

  if (body.isPrimary) {
    await prisma.repTerritory.updateMany({
      where: { repId, isPrimary: true },
      data: { isPrimary: false },
    });
  }

  await prisma.repTerritory.create({
    data: { repId, territoryId: body.territoryId, isPrimary: body.isPrimary || false },
  });

  return jsonResponse(201, { data: { success: true }, error: null });
};

export const loader = () =>
  jsonResponse(405, { data: null, error: { code: "METHOD_NOT_ALLOWED", message: "POST only" } });

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
