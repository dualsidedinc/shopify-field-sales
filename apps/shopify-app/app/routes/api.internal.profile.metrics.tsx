import type { LoaderFunctionArgs } from "react-router";
import { requireInternalAuth } from "../lib/internal-auth.server";
import { getRepDashboardMetrics } from "../services/repMetrics.server";

/**
 * GET /api/internal/profile/metrics
 * Returns the unified rep dashboard payload (revenue + quota +
 * top-companies-by-revenue). Single source of truth for the calculation —
 * field-app's /api/profile/metrics is a thin proxy to this.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  let auth;
  try {
    auth = await requireInternalAuth(request);
  } catch (res) {
    return res as Response;
  }

  try {
    const data = await getRepDashboardMetrics(auth.shopId, auth.repId, auth.role);
    return jsonResponse(200, { data, error: null });
  } catch (err) {
    console.error("[Internal API] Rep metrics failed:", err);
    return jsonResponse(500, {
      data: null,
      error: { code: "INTERNAL_ERROR", message: "Failed to fetch metrics" },
    });
  }
};

// Block other methods.
export const action = () =>
  jsonResponse(405, { data: null, error: { code: "METHOD_NOT_ALLOWED", message: "GET only" } });

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
