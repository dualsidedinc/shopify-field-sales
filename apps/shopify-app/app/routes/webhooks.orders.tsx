import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { enqueueJob } from "../services/queue/enqueue.server";

/**
 * Webhook receive endpoint — does the absolute minimum on the hot path:
 * authenticate, extract dedup id, enqueue, return 200.
 *
 * All processing happens in the worker (`worker.ts`) consuming from the
 * BullMQ WEBHOOK queue. See services/queue/handlers/webhooks.server.ts.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop, payload } = await authenticate.webhook(request);

  // Dedup key: prefer Shopify's stable order id (or other resource id)
  // present in the payload. Falls back to null for ad-hoc webhooks.
  const id = (payload as { id?: number; admin_graphql_api_id?: string }).id;
  const idempotencyKey = id ? String(id) : null;

  await enqueueJob({
    kind: "WEBHOOK",
    topic,
    payload: { shopDomain: shop, topic, payload },
    idempotencyKey,
    source: `shopify:${topic}`,
  });

  return new Response(null, { status: 200 });
};
