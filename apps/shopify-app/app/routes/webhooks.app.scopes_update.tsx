import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

/**
 * Auth-critical: stays INLINE intentionally (does not enqueue).
 *
 * When a merchant changes app scopes, the next API call from this app must
 * use the updated scope string — otherwise Shopify rejects the request
 * (the session would carry stale scopes). Queueing this would create a
 * window where the session is wrong, which can break embedded admin flows.
 *
 * The work itself is a single Postgres UPDATE — fast enough that inline
 * processing is never a bottleneck, even at high webhook volume.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { payload, session, topic, shop } = await authenticate.webhook(request);
  console.log(`[Webhook] Received ${topic} for ${shop}`);

  const current = payload.current as string[];
  if (session) {
    await db.session.update({
      where: { id: session.id },
      data: { scope: current.toString() },
    });
  }
  return new Response(null, { status: 200 });
};
