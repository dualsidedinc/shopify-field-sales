import { getAuthContext } from '@/lib/auth';
import { proxyToShopifyApp } from '@/services/shopifyAppClient';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(request: Request, { params }: RouteParams) {
  const auth = await getAuthContext();
  const { id } = await params;
  const body = await request.json().catch(() => ({}));

  return proxyToShopifyApp(auth, `/api/internal/orders/${id}/decline`, {
    method: 'POST',
    body,
  });
}
