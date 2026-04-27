# Architecture

How the two apps relate, where business logic lives, and how to add new endpoints without breaking the model.

## Responsibility split

| App | Role |
|---|---|
| **shopify-app** | Authoritative system for all shared business logic — order state machine, promotion engine, Shopify API integration, webhook dispatch, billing, scheduled jobs. |
| **field-app** | Thin UI/BFF for sales reps. Renders mobile screens, owns its own auth (rep login, JWT sessions), reads from the shared DB. **Does not contain business logic for shared processes** — it proxies them to shopify-app. |

Both apps share the same PostgreSQL database (`@field-sales/database`) and the same Redis instance.

```
┌─────────────────┐    proxy via     ┌─────────────────┐    GraphQL     ┌──────────┐
│   field-app     │ ───────────────▶ │  shopify-app    │ ─────────────▶ │ Shopify  │
│ (Next.js, BFF)  │  /api/internal/* │ (React Router)  │   webhooks     │  Admin   │
└────────┬────────┘                  └────────┬────────┘                └──────────┘
         │                                    │
         │ direct read                        │ direct read+write
         ▼                                    ▼
            ┌───────────────────────────────────────┐
            │        Shared PostgreSQL DB           │
            └───────────────────────────────────────┘
```

## Reads vs writes

| Operation type | Where it lives |
|---|---|
| **Reads** (list, detail, dashboard aggregates) | Either app may query the shared DB directly. Field-app keeps reads local to avoid an extra HTTP hop. |
| **Mutations on shared business state** (orders, companies, contacts, reps, territories, promotions, payment methods) | **shopify-app only.** Field-app proxies to `/api/internal/*`. |
| **Calls to Shopify Admin API** | **shopify-app only.** Field-app must never `fetch()` Shopify directly. |
| **Field-app session state** (cart sessions, OTP, login) | Field-app only. Cart never touches Shopify until it becomes a draft order via the `POST /api/orders` proxy. |

## The internal API pattern

Field-app routes that mutate shared state are thin proxies that forward the request to a matching endpoint on shopify-app under `/api/internal/*`.

### Helper: `proxyToShopifyApp` (field-app)

```ts
// apps/field-app/src/services/shopifyAppClient.ts
proxyToShopifyApp(auth, path, { method, body? })
```

Attaches `x-app-secret` + rep identity headers (`x-shop-id`, `x-rep-id`, `x-rep-role`), forwards to `${SHOPIFY_APP_URL}${path}`, returns shopify-app's response verbatim (status + body).

### Helper: `requireInternalAuth` (shopify-app)

```ts
// apps/shopify-app/app/lib/internal-auth.server.ts
const { shopId, repId, role } = await requireInternalAuth(request);
```

Validates the shared `APP_SECRET` and reads the rep identity from headers. Throws a 401 `Response` on failure.

### Auth fences

Two auth helpers, two purposes — **do not merge them**:

| Helper | Surface | Validates |
|---|---|---|
| `authenticate.admin(request)` (Shopify SDK) + your `authenticateRequest` for API keys | `/app/*`, public `/api/*` routes | Shopify session OR API key — returns `{ shop, admin }` |
| `requireInternalAuth(request)` | `/api/internal/*` only | Shared app secret + rep identity headers — returns `{ shopId, repId, role }` |

Path prefix `/api/internal/` is the visible boundary; the helper choice enforces it. If you put internal logic behind `authenticateRequest`, an API key holder could invoke business operations meant only for the field-app proxy.

## Adding a new mutation endpoint

1. **Build the internal endpoint in shopify-app:**
   ```
   apps/shopify-app/app/routes/api.internal.<resource>.<sub>.tsx
   ```
   - First call: `await requireInternalAuth(request)`
   - Use existing service functions in `app/services/*.server.ts` where they fit (`createOrder`, `updateSalesRep`, etc.). Add to a service if the logic is reusable; inline if single-use.
   - For Shopify GraphQL calls, get the admin client via `unauthenticated.admin(shop.shopifyDomain)`.
   - Write timeline events / fire webhooks here, not in field-app.
   - Return the shape the field-app client expects (often via `buildOrderDetailResponse` for orders).

2. **Replace the field-app handler with a proxy:**
   ```ts
   import { getAuthContext } from '@/lib/auth';
   import { proxyToShopifyApp } from '@/services/shopifyAppClient';

   export async function POST(request: Request) {
     const auth = await getAuthContext();
     const body = await request.json().catch(() => ({}));
     return proxyToShopifyApp(auth, '/api/internal/<resource>', { method: 'POST', body });
   }
   ```

3. **Preprocess in field-app only when it owns the concern.** Examples:
   - Password hashing (`bcryptjs` lives only in field-app — hash before proxying, send `passwordHash`)
   - Verifying current password during profile update (field-app's auth domain)

4. **Don't add `fetch('https://...shopify.com/...')` to field-app.** Ever.

## Adding a new read endpoint

Field-app may query the DB directly:

```ts
// apps/field-app/src/app/api/<resource>/route.ts
export async function GET(request: Request) {
  const { shopId, repId, role } = await getAuthContext();
  const items = await prisma.<model>.findMany({
    where: { shopId, ...(role === 'REP' && { /* rep scoping */ }) },
  });
  return NextResponse.json({ data: items, error: null });
}
```

Always include `shopId` in the where clause for tenant isolation. Apply rep scoping when the user is a `REP` role.

## Cross-app environment variables

Both apps need:

| Variable | Set in | Purpose |
|---|---|---|
| `APP_SECRET` | both apps (same value) | Shared secret for `x-app-secret` header |
| `SHOPIFY_APP_URL` | field-app | Base URL of shopify-app for proxy calls |
| `DATABASE_URL` | both apps (same value) | Shared Postgres connection |

In production on Render, set `SHOPIFY_APP_URL` to the shopify-app's **private** internal hostname (e.g. `http://field-sales-shopify-app:3000`) so traffic stays on the private network. The shopify-app retains its public URL for actual Shopify webhooks and the embedded admin.

> Defense in depth: `/api/internal/*` is still reachable on shopify-app's public domain. `APP_SECRET` is the actual security boundary. You can additionally block `/api/internal/*` on the public domain via reverse-proxy rules if you want a second layer.

## Existing internal endpoints (reference)

| Endpoint | Owner |
|---|---|
| `POST /api/internal/orders` | create draft (with promotion eval, order numbering, optional auto-submit) |
| `PUT /api/internal/orders/:id` | replace draft |
| `DELETE /api/internal/orders/:id` | soft-delete with timeline event |
| `POST /api/internal/orders/:id/submit` | DRAFT → AWAITING_REVIEW |
| `POST /api/internal/orders/:id/approve` | AWAITING_REVIEW → Shopify (uses `unauthenticated.admin`) |
| `POST /api/internal/orders/:id/decline` | AWAITING_REVIEW → DRAFT |
| `POST /api/internal/orders/:id/comments` | add comment timeline event |
| `POST /api/internal/tax/calculate` | Shopify draftOrderCalculate |
| `POST /api/internal/reps`, `PUT/DELETE /api/internal/reps/:id` | rep CRUD |
| `POST /api/internal/reps/:id/territories`, `DELETE /api/internal/reps/:id/territories/:territoryId` | rep ↔ territory |
| `POST /api/internal/territories`, `PUT/DELETE /api/internal/territories/:id` | territory CRUD |
| `POST /api/internal/companies`, `PUT /api/internal/companies/:id` | company CRUD (internal companies only — Shopify-managed companies sync via webhook) |
| `POST /api/internal/companies/:id/contacts` | add contact (internal companies only) |
| `DELETE /api/internal/companies/:id/payment-methods` | soft-remove payment method |
| `PUT /api/internal/profile` | rep updates own profile |

## Things that historically went wrong (and why the rules exist)

- **Order submit duplicated free gifts on reload.** Cause: field-app's PUT handler fed client-sent free items back to its own promotion engine; the engine treated them as $50 purchases and added another free gift. Fix: filter free items before evaluation. Why this couldn't have happened in the new model: there's only one promotion engine (in shopify-app), and `proxyToShopifyApp` doesn't double-process anything.
- **Field-app calling Shopify directly for tax calc.** Same shape of problem — two places to maintain, two places to break. Now lives once in `api.internal.tax.calculate.tsx` using `unauthenticated.admin`.
- **Submit/approve/decline endpoints missing in field-app.** The shared client called paths that didn't exist as routes (only as PATCH actions). Now each has a dedicated proxy + internal endpoint matching the client contract.
