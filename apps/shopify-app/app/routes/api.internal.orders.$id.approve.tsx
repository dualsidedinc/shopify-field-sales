import type { ActionFunctionArgs } from "react-router";
import prisma from "../db.server";
import { unauthenticated } from "../shopify.server";
import { requireInternalAuth } from "../lib/internal-auth.server";
import { submitOrderForPayment, addTimelineEvent } from "../services/order.server";
import { buildOrderDetailResponse } from "../services/order-detail-response.server";

/**
 * POST /api/internal/orders/:id/approve
 * Approves an AWAITING_REVIEW order, syncs it to Shopify as a draft/completed
 * order, and records the approval timeline event. Requires an offline Shopify
 * admin session for the shop (via `unauthenticated.admin`).
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

  const orderId = params.id;
  if (!orderId) {
    return jsonResponse(400, { data: null, error: { code: "VALIDATION_ERROR", message: "Order id required" } });
  }

  const body = await request.json().catch(() => ({} as { comment?: string; paymentMethodId?: string }));
  const comment = typeof body.comment === "string" ? body.comment.trim() : "";
  const paymentMethodId = typeof body.paymentMethodId === "string" ? body.paymentMethodId : null;

  const shop = await prisma.shop.findUnique({
    where: { id: auth.shopId },
    select: { shopifyDomain: true },
  });
  if (!shop) {
    return jsonResponse(404, { data: null, error: { code: "NOT_FOUND", message: "Shop not found" } });
  }

  const rep = await prisma.salesRep.findFirst({
    where: { id: auth.repId, shopId: auth.shopId },
    select: { firstName: true, lastName: true },
  });

  // Timeline event first (matches existing admin route ordering — approval is
  // recorded even if the Shopify sync step fails, so we retain the intent).
  await addTimelineEvent({
    orderId,
    authorType: auth.role === "REP" ? "SALES_REP" : "ADMIN",
    authorId: auth.repId,
    authorName: rep ? `${rep.firstName} ${rep.lastName}` : "Unknown",
    eventType: "approved",
    comment: comment || null,
  });

  try {
    const { admin } = await unauthenticated.admin(shop.shopifyDomain);
    const result = await submitOrderForPayment(auth.shopId, orderId, admin, {
      paymentMethodId: paymentMethodId || undefined,
      sendInvoice: !paymentMethodId,
    });

    if (!result.success) {
      return jsonResponse(400, { data: null, error: { code: "APPROVAL_FAILED", message: result.error } });
    }
  } catch (err) {
    console.error("[Internal API] Approve failed:", err);
    return jsonResponse(500, { data: null, error: { code: "INTERNAL_ERROR", message: "Failed to approve order" } });
  }

  const data = await buildOrderDetailResponse(orderId, auth.shopId);
  if (!data) {
    return jsonResponse(500, { data: null, error: { code: "INTERNAL_ERROR", message: "Failed to load order after approve" } });
  }

  return jsonResponse(200, { data, error: null });
};

export const loader = () =>
  jsonResponse(405, { data: null, error: { code: "METHOD_NOT_ALLOWED", message: "POST only" } });

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
