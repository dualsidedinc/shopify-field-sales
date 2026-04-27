import type { ActionFunctionArgs } from "react-router";
import { requireInternalAuth } from "../lib/internal-auth.server";
import { submitOrderForReview, addTimelineEvent } from "../services/order.server";
import { buildOrderDetailResponse } from "../services/order-detail-response.server";

/**
 * POST /api/internal/orders/:id/submit
 * Called by field-app when a rep submits a draft order for review.
 * Owns the DRAFT -> AWAITING_REVIEW transition and timeline event.
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

  const result = await submitOrderForReview(auth.shopId, orderId);
  if (!result.success) {
    return jsonResponse(400, { data: null, error: { code: "VALIDATION_ERROR", message: result.error } });
  }

  await addTimelineEvent({
    orderId,
    authorType: "SALES_REP",
    authorId: result.order.salesRepId,
    authorName: result.order.salesRepName,
    eventType: "submitted",
    comment: comment || null,
  });

  const data = await buildOrderDetailResponse(orderId, auth.shopId);
  if (!data) {
    return jsonResponse(500, { data: null, error: { code: "INTERNAL_ERROR", message: "Failed to load order after submit" } });
  }

  return jsonResponse(200, { data, error: null });
};

// Method guard: reject GET
export const loader = () =>
  jsonResponse(405, { data: null, error: { code: "METHOD_NOT_ALLOWED", message: "POST only" } });

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
