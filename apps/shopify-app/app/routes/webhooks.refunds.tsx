import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { enqueueJob } from "../services/queue/enqueue.server";

/**
 * Receive endpoint for `refunds/create`. Enqueues for the worker; the
 * actual refund processing (BillingEvent + Order denorm increment) lives
 * in services/queue/handlers/webhooks.server.ts.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop, payload } = await authenticate.webhook(request);

  const id = (payload as { id?: number }).id;
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
