# Field App - Claude Context

Mobile-first UI/BFF for field sales reps. **Thin layer** — owns rep UI + auth + reads, but proxies all mutations to shopify-app.

> **Read first:** [`docs/architecture.md`](../../../docs/architecture.md) at the repo root — defines the responsibility split between apps and the internal API pattern.
>
> **Feature docs:** [Orders](../docs/orders.md), [Accounts](../docs/accounts.md), [Products](../docs/products.md), [Promotions](../docs/promotions.md), [Cart](../docs/cart.md), [Auth](../docs/auth.md).

## Architecture

### Stack
- Next.js 16 with App Router
- TypeScript (strict mode)
- Tailwind CSS (mobile-first)
- Prisma ORM with PostgreSQL

### Key Directories
```
src/
├── app/
│   ├── (app)/          # Authenticated routes
│   ├── api/            # API route handlers (proxies + reads)
│   └── login/          # Public login page
├── components/         # React components
├── lib/                # Utilities (auth, db, redis)
├── services/           # Field-app-specific helpers (e.g. shopifyAppClient)
└── types/              # TypeScript definitions
```

### Architectural rules (DO NOT BREAK)

1. **No Shopify API calls.** This app must never `fetch('https://...myshopify.com/...')` or call `admin.graphql(...)`. All Shopify integration lives in shopify-app.
2. **No business logic for shared state.** Mutations on orders, companies, contacts, reps, territories, promotions, and payment methods MUST proxy to `/api/internal/<resource>` on shopify-app via `proxyToShopifyApp`. Don't run the promotion engine, write timeline events, or transition order status here.
3. **Reads stay local.** Direct Prisma queries against the shared DB are fine for GET endpoints — keeps latency low. Always filter by `shopId`.
4. **Field-app-only concerns stay here.** Rep auth (login, OTP, JWT sessions), cart sessions, password hashing (`bcryptjs`), and current-password verification all belong in field-app.

### Adding an API endpoint

**Read** (GET) — direct DB query:
```typescript
export async function GET(request: Request) {
  const { shopId, repId, role } = await getAuthContext();
  const data = await prisma.company.findMany({
    where: { shopId, ...(role === 'REP' && { /* rep scoping */ }) },
  });
  return NextResponse.json({ data, error: null });
}
```

**Mutation** (POST/PUT/DELETE) — proxy to shopify-app:
```typescript
import { getAuthContext } from '@/lib/auth';
import { proxyToShopifyApp } from '@/services/shopifyAppClient';

export async function POST(request: Request) {
  const auth = await getAuthContext();
  const body = await request.json().catch(() => ({}));
  return proxyToShopifyApp(auth, '/api/internal/<resource>', { method: 'POST', body });
}
```

If the mutation doesn't have a matching internal endpoint yet, add one in shopify-app first under `app/routes/api.internal.*.tsx` — see [`docs/architecture.md`](../../../docs/architecture.md#adding-a-new-mutation-endpoint).

**Mutation with field-app preprocessing** (e.g. password hashing) — preprocess locally, then proxy:
```typescript
const { password, ...rest } = body;
const passwordHash = await hashPassword(password);
return proxyToShopifyApp(auth, '/api/internal/reps', {
  method: 'POST',
  body: { ...rest, passwordHash },
});
```

### Error Response
```typescript
return NextResponse.json<ApiError>(
  { data: null, error: { code: 'NOT_FOUND', message: 'Resource not found' } },
  { status: 404 }
);
```

## Important Conventions

### Money
- Store in cents as integers (`totalCents`, `priceCents`)
- Convert to dollars only for display

### IDs
- Internal: CUIDs (`clxyz123...`)
- Shopify: GIDs (`gid://shopify/Product/123`)

### Multi-Tenancy
- Every query MUST include `shopId` filter
- Never expose data across tenants

### Database
- Uses shared `@field-sales/database` package
- Schema lives in `packages/database/prisma/schema.prisma`
- Import Prisma client and types from `@field-sales/database`

```typescript
import { prisma } from '@/lib/db/prisma';
import type { Company, Order } from '@field-sales/database';
```

## Quick Commands

```bash
npm run dev           # Start dev server (port 3001)
```

## Common Tasks

### Add API Endpoint

**For reads:**
1. Create `src/app/api/[resource]/route.ts` with a `GET` handler.
2. Use `getAuthContext()` for auth.
3. Filter by `shopId` (and rep scoping when `role === 'REP'`) in all queries.
4. Return `{ data, error }` format.

**For mutations:**
1. Add the internal endpoint in shopify-app first (`apps/shopify-app/app/routes/api.internal.<resource>.tsx`) using `requireInternalAuth`.
2. Add the field-app proxy with `proxyToShopifyApp(auth, '/api/internal/<resource>', { method, body })`.
3. See [`docs/architecture.md`](../../../docs/architecture.md) for the full checklist.

## Database Management

**IMPORTANT:** Both apps share a single database schema. All schema changes are made in `packages/database/prisma/schema.prisma`.

### Schema Location
```
packages/database/
├── prisma/
│   ├── schema.prisma    # THE schema (edit this)
│   ├── migrations/      # Migration history
│   └── seed.ts          # Seed data
└── src/
    ├── client.ts        # Prisma client singleton
    └── index.ts         # Exports client + types
```

### Database Commands (run from monorepo root)
```bash
npm run db:push       # Push schema changes (dev - no migration)
npm run db:migrate    # Create migration (production)
npm run db:generate   # Regenerate Prisma client only
npm run db:seed       # Seed sample data
npm run db:studio     # Open Prisma Studio GUI
```

### How to Update the Schema

1. **Edit the schema:**
   ```bash
   # Edit packages/database/prisma/schema.prisma
   ```

2. **Push changes to database (development):**
   ```bash
   cd /path/to/shopify-field-sales
   npm run db:push
   ```

3. **Both apps automatically get the updated types** - the Prisma client is regenerated and shared via the `@field-sales/database` package.

### Adding a New Model

1. Add the model to `packages/database/prisma/schema.prisma`:
   ```prisma
   model NewModel {
     id        String   @id @default(cuid())
     shopId    String
     name      String
     createdAt DateTime @default(now())
     updatedAt DateTime @updatedAt

     shop Shop @relation(fields: [shopId], references: [id])

     @@index([shopId])
     @@map("new_models")
   }
   ```

2. Add the relation to Shop model if needed:
   ```prisma
   model Shop {
     // ... existing fields
     newModels NewModel[]
   }
   ```

3. Run `npm run db:push` from monorepo root

4. Import and use in either app:
   ```typescript
   import type { NewModel } from '@field-sales/database';
   ```

### Adding a Field to Existing Model

1. Edit `packages/database/prisma/schema.prisma`
2. Run `npm run db:push` from monorepo root
3. Use the new field immediately - types are auto-updated

### Resetting the Database (dev only)
```bash
cd packages/database
npx prisma migrate reset  # Drops all data, re-runs migrations + seed
```
