import type { ActionFunctionArgs } from "react-router";
import prisma from "../db.server";
import { requireInternalAuth } from "../lib/internal-auth.server";
import { addTimelineEvent } from "../services/order.server";
import { buildOrderDetailResponse } from "../services/order-detail-response.server";

/**
 * POST /api/internal/orders/:id/comments
 * Adds a standalone comment timeline event to an order.
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

  const body = await request.json().catch(() => ({} as { comment?: string }));
  const comment = typeof body.comment === "string" ? body.comment.trim() : "";

  if (!comment) {
    return jsonResponse(400, { data: null, error: { code: "VALIDATION_ERROR", message: "Comment is required" } });
  }

  const order = await prisma.order.findFirst({
    where: { id: orderId, shopId: auth.shopId },
    select: { id: true },
  });
  if (!order) {
    return jsonResponse(404, { data: null, error: { code: "NOT_FOUND", message: "Order not found" } });
  }

  const rep = await prisma.salesRep.findFirst({
    where: { id: auth.repId, shopId: auth.shopId },
    select: { firstName: true, lastName: true },
  });

  await addTimelineEvent({
    orderId,
    authorType: auth.role === "REP" ? "SALES_REP" : "ADMIN",
    authorId: auth.repId,
    authorName: rep ? `${rep.firstName} ${rep.lastName}` : "Unknown",
    eventType: "comment",
    comment,
  });

  const data = await buildOrderDetailResponse(orderId, auth.shopId);
  if (!data) {
    return jsonResponse(500, { data: null, error: { code: "INTERNAL_ERROR", message: "Failed to load order after comment" } });
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
