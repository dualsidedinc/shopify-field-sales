import type { ActionFunctionArgs } from "react-router";
import prisma from "../db.server";
import { requireInternalAuth } from "../lib/internal-auth.server";

/**
 * DELETE /api/internal/reps/:id/territories/:territoryId — unassign.
 */
export const action = async ({ request, params }: ActionFunctionArgs) => {
  if (request.method !== "DELETE") {
    return jsonResponse(405, { data: null, error: { code: "METHOD_NOT_ALLOWED", message: "DELETE only" } });
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
  const territoryId = params.territoryId;
  if (!repId || !territoryId) {
    return jsonResponse(400, { data: null, error: { code: "VALIDATION_ERROR", message: "Rep id and territory id required" } });
  }

  const rep = await prisma.salesRep.findFirst({ where: { id: repId, shopId: auth.shopId } });
  if (!rep) {
    return jsonResponse(404, { data: null, error: { code: "NOT_FOUND", message: "Rep not found" } });
  }

  const repTerritory = await prisma.repTerritory.findFirst({
    where: { repId, territoryId, territory: { shopId: auth.shopId } },
  });
  if (!repTerritory) {
    return jsonResponse(404, { data: null, error: { code: "NOT_FOUND", message: "Territory assignment not found" } });
  }

  await prisma.repTerritory.delete({ where: { id: repTerritory.id } });
  return jsonResponse(200, { data: { success: true }, error: null });
};

export const loader = () =>
  jsonResponse(405, { data: null, error: { code: "METHOD_NOT_ALLOWED", message: "DELETE only" } });

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
