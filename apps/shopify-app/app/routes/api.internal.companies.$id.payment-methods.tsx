import type { ActionFunctionArgs } from "react-router";
import prisma from "../db.server";
import { requireInternalAuth } from "../lib/internal-auth.server";

/**
 * DELETE /api/internal/companies/:id/payment-methods?paymentMethodId=...
 * Soft-removes a payment method (marks inactive). If it was default, promotes
 * another active method to default.
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

  const companyId = params.id;
  if (!companyId) {
    return jsonResponse(400, { data: null, error: { code: "VALIDATION_ERROR", message: "Company id required" } });
  }

  const url = new URL(request.url);
  const paymentMethodId = url.searchParams.get("paymentMethodId");
  if (!paymentMethodId) {
    return jsonResponse(400, { data: null, error: { code: "VALIDATION_ERROR", message: "paymentMethodId query param required" } });
  }

  const company = await prisma.company.findFirst({
    where: {
      id: companyId,
      shopId: auth.shopId,
      ...(auth.role === "REP" && {
        OR: [
          { assignedRepId: auth.repId },
          { territory: { repTerritories: { some: { repId: auth.repId } } } },
        ],
      }),
    },
  });
  if (!company) {
    return jsonResponse(404, { data: null, error: { code: "NOT_FOUND", message: "Company not found" } });
  }

  const paymentMethod = await prisma.paymentMethod.findFirst({
    where: { id: paymentMethodId, shopId: auth.shopId, companyId },
  });
  if (!paymentMethod) {
    return jsonResponse(404, { data: null, error: { code: "NOT_FOUND", message: "Payment method not found" } });
  }

  await prisma.paymentMethod.update({
    where: { id: paymentMethodId },
    data: { isActive: false },
  });

  if (paymentMethod.isDefault) {
    const next = await prisma.paymentMethod.findFirst({
      where: { shopId: auth.shopId, companyId, isActive: true },
      orderBy: { createdAt: "desc" },
    });
    if (next) {
      await prisma.paymentMethod.update({ where: { id: next.id }, data: { isDefault: true } });
    }
  }

  return jsonResponse(200, { data: { deleted: true }, error: null });
};

export const loader = () =>
  jsonResponse(405, { data: null, error: { code: "METHOD_NOT_ALLOWED", message: "DELETE only" } });

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
