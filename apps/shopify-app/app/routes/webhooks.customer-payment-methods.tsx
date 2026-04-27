import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { enqueueJob } from "../services/queue/enqueue.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop, payload } = await authenticate.webhook(request);

  // Dedup key: use the payment method GID since payloads may not have a numeric `id`.
  const adminGid = (payload as { admin_graphql_api_id?: string }).admin_graphql_api_id;
  const idempotencyKey = adminGid ?? null;

  await enqueueJob({
    kind: "WEBHOOK",
    topic,
    payload: { shopDomain: shop, topic, payload },
    idempotencyKey,
    source: `shopify:${topic}`,
  });

  return new Response(null, { status: 200 });
};
