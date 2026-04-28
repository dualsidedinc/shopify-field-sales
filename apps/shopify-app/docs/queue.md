# Background Job Queue

Generic async-job system for any work that should run with retries and audit:
inbound webhooks, outbound API calls, file imports, scheduled actions.

## The model

```
┌──────────────────┐      ┌──────────────────┐     ┌──────────────────┐
│  Receive route   │ ───► │  enqueueJob()    │ ──► │  Postgres        │
│  (webhook etc.)  │      │                  │     │  QueueJob row    │
└──────────────────┘      │                  │ ──► │  Redis (BullMQ)  │
                          └──────────────────┘     └────────┬─────────┘
                                                            │
                                                            ▼
                                                   ┌──────────────────┐
                                                   │  Worker process  │
                                                   │  (worker.ts)     │
                                                   └────────┬─────────┘
                                                            │
                                                            ▼
                                                   ┌──────────────────┐
                                                   │  Registered      │
                                                   │  handler runs    │
                                                   └──────────────────┘
```

`QueueJob` (Postgres) is the durable audit/dedup record. BullMQ (Redis) is the
in-flight processing layer with retries and concurrency.

## Kinds

One BullMQ queue per `QueueJobKind`. Each kind has its own concurrency,
retry, and rate-limit profile (defined in `services/queue/queue.server.ts`).

| Kind | Use | Concurrency | Attempts | Backoff |
|---|---|---|---|---|
| `WEBHOOK` | Inbound Shopify webhooks | 25 | 5 | 1s exponential |
| `API` | Outbound API calls (Shopify GraphQL retries, third-party) | 8 | 10 | 5s exponential |
| `FILE_IMPORT` | Bulk imports from uploads | 2 | 1 (no auto-retry) | — |
| `ACTION` | Cron/admin-triggered work (sync, billing close, etc.) | 3 | 3 | 30s exponential |

## Enqueueing

Single public entry point — call from anywhere on the server:

```ts
import { enqueueJob } from "~/services/queue/enqueue.server";

await enqueueJob({
  kind: "WEBHOOK",
  topic: "orders/paid",
  shopId,                                  // optional
  idempotencyKey: shopifyOrderId,          // optional, dedup at receive time
  payload: { shopDomain, topic, payload }, // arbitrary JSON
  source: "shopify:orders/paid",           // who enqueued, for debugging
});
```

`(kind, topic, idempotencyKey)` is unique — duplicate enqueues are no-ops at
the QueueJob level AND the BullMQ level (jobId dedup). Pass an
`idempotencyKey` whenever you have a natural one (Shopify event id, request
hash, batch id). Leave null for ad-hoc jobs that should always create a new
row.

## Adding a handler

Two steps:

```ts
// services/queue/handlers/my-feature.server.ts
import { registerHandler, type JobHandler } from "../registry.server";

const handleMyJob: JobHandler = async (job) => {
  const { someField } = job.payload as { someField: string };
  // ... do the work; throw on failure
};

export function registerMyFeatureHandlers(): void {
  registerHandler("ACTION", "my-feature:do-work", handleMyJob);
}
```

```ts
// worker.ts — add to the registration block
registerMyFeatureHandlers();
```

Handlers receive the full `QueueJob` row. Throw on failure → BullMQ retries
per the kind's profile. Permanent failures land in the `FAILED` bucket.

## Webhook receive flow

Receive routes do nothing but enqueue:

```ts
// routes/webhooks.orders.tsx
export const action = async ({ request }) => {
  const { topic, shop, payload } = await authenticate.webhook(request);
  await enqueueJob({
    kind: "WEBHOOK",
    topic,
    payload: { shopDomain: shop, topic, payload },
    idempotencyKey: String(payload.id),
    source: `shopify:${topic}`,
  });
  return new Response(null, { status: 200 });
};
```

Sub-50ms ack to Shopify regardless of processing complexity downstream. The
worker handles the actual `processOrderWebhook` / refund / billing logic.

### Registered WEBHOOK topics

Every Shopify webhook subscribed in `shopify.app.toml` is enqueued. Handlers
are registered in `services/queue/handlers/webhooks.server.ts`.

| Topic | Worker dispatches to |
|---|---|
| `orders/paid` | `processOrderWebhook` — flips status to PAID, writes `BillingEvent { type: PAID }` |
| `orders/cancelled` | `processOrderWebhook` — flips status to CANCELLED |
| `orders/updated` | `processOrderWebhook` — handles refund-status transition |
| `orders/create` | `processOrderWebhook` — link Shopify order to local |
| `refunds/create` | inline handler — sums successful refund txns, writes `BillingEvent { type: REFUNDED }` |
| `draft_orders/update` | `processDraftOrderWebhook` — link order id when draft completes |
| `companies/{create,update,delete}` | `processCompanyWebhook` |
| `company_locations/{create,update}` | `syncCompanyDetails` (full company sync) |
| `company_locations/delete` | `processCompanyLocationWebhook` |
| `company_contacts/{create,update}` | `syncCompanyDetails` (full company sync) |
| `company_contacts/delete` | direct `companyContact.deleteMany` |
| `customer_payment_methods/{create,update,revoke}` | `syncCustomerPaymentMethodsWebhook` |
| `products/{create,update,delete}` | `processProductWebhook` |
| `app_subscriptions/update` | `handleSubscriptionUpdate` — billing status transitions |
| `app_subscriptions/approaching_capped_amount` | log only (TODO: notify merchant + auto-bump cap) |
| `app/uninstalled` | `cancelBilling` — business-side cleanup |

### Auth-critical exceptions (still inline)

Two routes intentionally **do not** use the queue, because the work must be
visible to subsequent requests immediately:

- **`/webhooks/app/scopes_update`** — updates `Session.scope` in Postgres so
  the next API call uses the correct scope string. Queueing would create a
  window where Shopify rejects requests with stale scopes.
- **`/webhooks/app/uninstalled`** — deletes the OAuth `Session` row inline
  (immediate revocation), then **also** enqueues for business-side cleanup
  (`cancelBilling`). Hybrid: critical state inline, async work queued.

Both are documented in their route files. The work itself is a single
Postgres write — fast enough that inline never bottlenecks.

## Failure handling

- **Transient failures** — handler throws → BullMQ schedules a retry per the
  kind's profile.
- **Permanent failures** — after exhausting `attempts`, the QueueJob row is
  marked `FAILED` with `lastError` populated, and the BullMQ job lands in
  the failed-jobs queue.
- **Visibility** — query `SELECT * FROM queue_jobs WHERE status = 'FAILED'`
  for a dead-letter view across all kinds. Future: a Bull Board admin route
  for replay.

## Cleanup

The `scheduled.queue-cleanup` BullMQ job (daily at 03:00 UTC, registered in
`app/services/queue/schedules.server.ts`) prunes:
- `COMPLETED` rows older than 30 days
- `FAILED` rows older than 90 days

`QUEUED` and `PROCESSING` rows are never pruned. BullMQ jobs auto-prune via
`removeOnComplete` / `removeOnFail` config in `queue.server.ts`.

## Deployment shape (Render)

| Service | Type | Purpose |
|---|---|---|
| `field-sales-shopify-app` | Web | Receives webhooks, runs admin UI, handles internal API |
| `field-sales-queue-worker` | Worker | Runs `worker.ts` — consumes BullMQ jobs |
| `field-sales-redis` | Redis | BullMQ backing store |
| `field-sales-db` | Postgres | QueueJob audit + everything else |

Both web and worker share `REDIS_URL` and `DATABASE_URL`. Scale the worker
service independently as throughput grows — start with 1 instance, bump to
2-3 once sustained queue depth warrants it.

## Local development

```bash
# Terminal 1: web app
cd apps/shopify-app
npm run dev

# Terminal 2: queue worker (auto-restarts on file changes)
cd apps/shopify-app
npm run worker:dev
```

Both connect to the same local Postgres + Redis.
