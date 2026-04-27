import { getAuthContext } from '@/lib/auth';
import { proxyToShopifyApp } from '@/services/shopifyAppClient';

/**
 * POST /api/tax/calculate
 * Proxies to shopify-app, which is the only place allowed to talk to Shopify.
 */
export async function POST(request: Request) {
  const auth = await getAuthContext();
  const body = await request.json().catch(() => ({}));
  return proxyToShopifyApp(auth, '/api/internal/tax/calculate', { method: 'POST', body });
}
