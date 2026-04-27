import type { ActionFunctionArgs } from "react-router";
import prisma from "../db.server";
import { requireInternalAuth } from "../lib/internal-auth.server";

interface UpdateCompanyRequest {
  assignedRepId?: string | null;
  territoryId?: string | null;
}

/**
 * PUT /api/internal/companies/:id — update assigned rep / territory.
 */
export const action = async ({ request, params }: ActionFunctionArgs) => {
  if (request.method !== "PUT") {
    return jsonResponse(405, { data: null, error: { code: "METHOD_NOT_ALLOWED", message: "PUT only" } });
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

  const body = (await request.json().catch(() => ({}))) as UpdateCompanyRequest;

  const company = await prisma.company.findFirst({ where: { id: companyId, shopId: auth.shopId } });
  if (!company) {
    return jsonResponse(404, { data: null, error: { code: "NOT_FOUND", message: "Company not found" } });
  }

  if (body.assignedRepId) {
    const rep = await prisma.salesRep.findFirst({
      where: { id: body.assignedRepId, shopId: auth.shopId, isActive: true },
    });
    if (!rep) {
      return jsonResponse(400, { data: null, error: { code: "VALIDATION_ERROR", message: "Invalid rep ID" } });
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

  const updated = await prisma.company.update({
    where: { id: companyId },
    data: {
      ...(body.assignedRepId !== undefined && { assignedRepId: body.assignedRepId }),
      ...(body.territoryId !== undefined && { territoryId: body.territoryId }),
    },
  });

  return jsonResponse(200, { data: updated, error: null });
};

export const loader = () =>
  jsonResponse(405, { data: null, error: { code: "METHOD_NOT_ALLOWED", message: "PUT only" } });

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
