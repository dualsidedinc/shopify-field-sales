import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { enqueueJob } from "../services/queue/enqueue.server";

/**
 * Receive endpoint for app_subscriptions/* and app/uninstalled. Enqueues
 * for the worker; processing in services/queue/handlers/webhooks.server.ts.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop, payload } = await authenticate.webhook(request);

  // Subscription updates carry the subscription id in
  // payload.app_subscription.admin_graphql_api_id. Use it as the dedup key.
  const sub = (payload as { app_subscription?: { admin_graphql_api_id?: string } })
    .app_subscription;
  const idempotencyKey = sub?.admin_graphql_api_id ?? null;

  await enqueueJob({
    kind: "WEBHOOK",
    topic,
    payload: { shopDomain: shop, topic, payload },
    idempotencyKey,
    source: `shopify:${topic}`,
  });

  return new Response(null, { status: 200 });
};
