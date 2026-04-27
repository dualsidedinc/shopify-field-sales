import type { AuthContext } from '@/lib/auth';

/**
 * Server-side HTTP client for proxying requests from field-app API routes to
 * shopify-app internal endpoints. Field-app is a thin UI layer; anything
 * that mutates shared business state runs in shopify-app.
 *
 * The client attaches the rep identity from `getAuthContext()` plus the
 * shared app secret. shopify-app validates these via `requireInternalAuth`.
 */

function getShopifyAppBaseUrl(): string {
  const url = process.env.SHOPIFY_APP_URL;
  if (!url) {
    throw new Error('SHOPIFY_APP_URL not configured — cannot proxy to shopify-app');
  }
  return url.replace(/\/$/, '');
}

function getAppSecret(): string {
  const secret = process.env.APP_SECRET;
  if (!secret) {
    throw new Error('APP_SECRET not configured — cannot authenticate to shopify-app');
  }
  return secret;
}

/**
 * Proxy the incoming field-app request to a shopify-app internal endpoint.
 * Returns a `NextResponse`-compatible Response with shopify-app's body verbatim.
 *
 * Use this when the field-app route is a pure pass-through. The caller is
 * responsible for passing the rep's auth context (usually obtained via
 * `getAuthContext()`).
 */
export async function proxyToShopifyApp(
  auth: AuthContext,
  path: string,
  init: { method: string; body?: unknown }
): Promise<Response> {
  const url = `${getShopifyAppBaseUrl()}${path}`;

  const res = await fetch(url, {
    method: init.method,
    headers: {
      'Content-Type': 'application/json',
      'x-app-secret': getAppSecret(),
      'x-shop-id': auth.shopId,
      'x-rep-id': auth.repId,
      'x-rep-role': auth.role,
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });

  // Forward body and status verbatim.
  const bodyText = await res.text();
  return new Response(bodyText, {
    status: res.status,
    headers: { 'Content-Type': res.headers.get('content-type') || 'application/json' },
  });
}
