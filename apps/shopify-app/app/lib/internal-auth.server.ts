/**
 * Internal API auth — for app-to-app calls from field-app.
 *
 * Field-app authenticates sales reps via its own JWT sessions. When it needs
 * to invoke a shared business operation, it proxies to shopify-app with:
 *  - `x-app-secret` : shared secret proving the caller is the field-app
 *  - `x-shop-id`    : the rep's shop (matches DB `Shop.id`)
 *  - `x-rep-id`     : the rep's id
 *  - `x-rep-role`   : the rep's role (e.g. REP, MANAGER)
 *
 * This helper validates those headers and returns the caller identity.
 * Throws a Response (handled by React Router) on failure.
 */

export type RepRole = "REP" | "MANAGER" | "ADMIN";

export interface InternalAuthContext {
  shopId: string;
  repId: string;
  role: RepRole;
}

export async function requireInternalAuth(request: Request): Promise<InternalAuthContext> {
  const expectedSecret = process.env.APP_SECRET;
  if (!expectedSecret) {
    console.error("[Internal API] APP_SECRET not configured");
    throw jsonError(500, "INTERNAL_CONFIG", "Server not configured for internal auth");
  }

  const providedSecret = request.headers.get("x-app-secret");
  if (providedSecret !== expectedSecret) {
    throw jsonError(401, "UNAUTHORIZED", "Invalid internal app secret");
  }

  const shopId = request.headers.get("x-shop-id");
  const repId = request.headers.get("x-rep-id");
  const role = request.headers.get("x-rep-role") as RepRole | null;

  if (!shopId || !repId || !role) {
    throw jsonError(400, "VALIDATION_ERROR", "Missing identity headers");
  }

  return { shopId, repId, role };
}

function jsonError(status: number, code: string, message: string): Response {
  return new Response(JSON.stringify({ data: null, error: { code, message } }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
