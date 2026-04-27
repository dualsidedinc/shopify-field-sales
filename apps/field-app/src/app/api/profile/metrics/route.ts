import { getAuthContext } from '@/lib/auth';
import { proxyToShopifyApp } from '@/services/shopifyAppClient';

/**
 * GET /api/profile/metrics — unified rep dashboard payload (revenue +
 * quota + top companies by revenue). Proxies to shopify-app where the
 * calculation lives so both apps stay in sync.
 */
export async function GET() {
  const auth = await getAuthContext();
  return proxyToShopifyApp(auth, '/api/internal/profile/metrics', { method: 'GET' });
}
