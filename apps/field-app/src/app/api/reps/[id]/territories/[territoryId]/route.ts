import { getAuthContext } from '@/lib/auth';
import { proxyToShopifyApp } from '@/services/shopifyAppClient';

interface RouteParams {
  params: Promise<{ id: string; territoryId: string }>;
}

/**
 * DELETE /api/reps/:id/territories/:territoryId — proxy.
 */
export async function DELETE(_request: Request, { params }: RouteParams) {
  const auth = await getAuthContext();
  const { id, territoryId } = await params;
  return proxyToShopifyApp(
    auth,
    `/api/internal/reps/${id}/territories/${territoryId}`,
    { method: 'DELETE' }
  );
}
