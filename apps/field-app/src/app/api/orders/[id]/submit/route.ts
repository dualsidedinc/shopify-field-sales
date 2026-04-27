import { getAuthContext } from '@/lib/auth';
import { proxyToShopifyApp } from '@/services/shopifyAppClient';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/orders/:id/submit
 * Thin proxy: business logic lives in shopify-app.
 * See /api/internal/orders/:id/submit on the shopify-app side.
 */
export async function POST(request: Request, { params }: RouteParams) {
  const auth = await getAuthContext();
  const { id } = await params;
  const body = await request.json().catch(() => ({}));

  return proxyToShopifyApp(auth, `/api/internal/orders/${id}/submit`, {
    method: 'POST',
    body,
  });
}
