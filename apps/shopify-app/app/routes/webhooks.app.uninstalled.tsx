import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { enqueueJob } from "../services/queue/enqueue.server";

/**
 * Hybrid: session cleanup runs INLINE (auth-critical — must happen before
 * any subsequent request from this shop is rejected), and the business-side
 * cleanup (cancel billing, etc.) is enqueued for async processing.
 *
 * Webhook can trigger multiple times after an app is uninstalled — both the
 * inline `deleteMany` and the queued handler are idempotent so retries are
 * safe.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, session, topic, payload } = await authenticate.webhook(request);

  // 1. Inline: delete OAuth session(s) so further requests are rejected
  //    immediately. Idempotent.
  if (session) {
    await db.session.deleteMany({ where: { shop } });
  }

  // 2. Queue the business-side cleanup (cancel billing, etc.). The
  //    `app/uninstalled` handler in services/queue/handlers/webhooks.server.ts
  //    runs cancelBilling for the shop.
  await enqueueJob({
    kind: "WEBHOOK",
    topic,
    payload: { shopDomain: shop, topic, payload },
    idempotencyKey: shop, // one cleanup job per shop is enough
    source: `shopify:${topic}`,
  });

  return new Response(null, { status: 200 });
};
