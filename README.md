# Field Sales Manager

A B2B field sales application for Shopify merchants. Enables sales reps to manage accounts, place orders, and track sales while on the road.

## Architecture

This is a monorepo containing two applications:

| App | Description | Port | Stack |
|-----|-------------|------|-------|
| `shopify-app` | Shopify embedded admin app **and** the authoritative system for all shared business logic | 3000 | React Router, Shopify App Bridge |
| `field-app` | Mobile-first UI/BFF for sales reps. Owns its own auth + reads; proxies all mutations to shopify-app | 3001 | Next.js 16, Tailwind CSS |

**Important:** field-app does not contain business logic for shared processes. Mutations go to `/api/internal/*` endpoints on shopify-app via the proxy helper. Field-app must never call the Shopify Admin API directly. **See [`docs/architecture.md`](./docs/architecture.md) for the full responsibility split, internal API pattern, auth model, and a checklist for adding new endpoints.**

Both apps share:
- A PostgreSQL database (same schema, multi-tenant by `shopId`)
- A Redis instance (session caching, rate limiting)
- Shared TypeScript types (`packages/shared`)

```
field-sales-manager/
├── apps/
│   ├── shopify-app/     # Shopify embedded app + business logic owner
│   └── field-app/       # Field sales rep UI + BFF
├── packages/
│   └── shared/          # Shared types and utilities
├── docs/
│   └── architecture.md  # Cross-app responsibility model — read this first
├── render.yaml          # Render deployment config
└── package.json         # Workspace root
```

## Prerequisites

- **Node.js** >= 20.0.0
- **PostgreSQL** 14+
- **Redis** 6+
- **Shopify Partner Account** (for app development)
- **Shopify CLI** (`npm install -g @shopify/cli`)

## Local Development Setup

### 1. Clone and Install

```bash
git clone <repository-url>
cd field-sales-manager
npm install
```

### 2. Set Up PostgreSQL

Create a PostgreSQL database:

```bash
createdb field_sales_manager
```

Or using Docker:

```bash
docker run -d \
  --name field-sales-postgres \
  -e POSTGRES_DB=field_sales_manager \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -p 5432:5432 \
  postgres:16
```

### 3. Set Up Redis

Using Docker:

```bash
docker run -d \
  --name field-sales-redis \
  -p 6379:6379 \
  redis:7-alpine
```

Or install locally via Homebrew (macOS):

```bash
brew install redis
brew services start redis
```

### 4. Configure Environment Variables

#### Shopify App (`apps/shopify-app`)

The Shopify CLI manages most environment variables. Run:

```bash
cd apps/shopify-app
shopify app config link
```

This creates `.env` with your Shopify app credentials.

#### Field App (`apps/field-app`)

```bash
cd apps/field-app
cp .env.example .env
```

Edit `.env` with your values:

```env
# Database
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/field_sales_manager?schema=public"

# Redis
REDIS_URL="redis://localhost:6379"

# Authentication (field-app rep sessions)
JWT_SECRET="your-random-secret-minimum-32-characters"
JWT_EXPIRES_IN="1h"
REFRESH_TOKEN_EXPIRES_IN="7d"

# Cross-app proxy — must match the value set in apps/shopify-app
APP_SECRET="shared-secret-also-set-in-shopify-app"

# Where field-app proxies mutations. In dev, this is shopify-app's local URL.
# In prod on Render, prefer the private internal hostname (e.g. http://field-sales-shopify-app:3000)
SHOPIFY_APP_URL="http://localhost:3000"
```

> The same `APP_SECRET` must be set on `apps/shopify-app` — that's how `requireInternalAuth` validates that incoming `/api/internal/*` requests are coming from field-app.

### 5. Initialize Database

Generate Prisma clients and run migrations:

```bash
# Generate Prisma client for shopify-app
cd apps/shopify-app
npx prisma generate
npx prisma migrate dev

# Generate Prisma client for field-app
cd ../field-app
npx prisma generate
npx prisma db push
```

### 6. Seed Development Data (Optional)

```bash
cd apps/field-app
npm run db:seed
```

This creates sample shops, reps, companies, and products for testing.

## Running the Apps

### Shopify App (Embedded Admin)

```bash
# From repo root
npm run dev:shopify

# Or from app directory
cd apps/shopify-app
npm run dev
```

The Shopify CLI starts a tunnel and opens the app in your development store.

### Field App (Sales Rep Portal)

```bash
# From repo root
npm run dev:field

# Or from app directory
cd apps/field-app
npm run dev
```

Visit http://localhost:3001

#### Dev Login

In development mode, visit `/login` and select a sales rep to authenticate without credentials.

## Database Schema

Both apps share the same database with these core models:

- **Shop** - Shopify store (tenant)
- **SalesRep** - Sales representatives (users of field-app)
- **Territory** - Geographic sales territories
- **Company** - B2B customer accounts (synced from Shopify)
- **Product/ProductVariant** - Products catalog (synced from Shopify)
- **Order/OrderLineItem** - Orders placed through field-app
- **Promotion** - App-managed discounts and campaigns
- **CartSession** - Active shopping carts

## Key Features

### For Merchants (Shopify App)
- Configure sales territories
- Manage sales rep accounts
- View sales analytics
- Configure promotions and pricing rules

### For Sales Reps (Field App)
- View assigned accounts/territories
- Browse product catalog
- Build orders with cart
- Apply promotions automatically
- Track order history

## API surface

Field-app exposes the API the rep UI consumes. Each route is one of three things:

- **Read** — direct DB query (lives in field-app).
- **Proxy** — forwards to `/api/internal/<resource>` on shopify-app via `proxyToShopifyApp`.
- **Field-app-only concern** — auth, OTP, cart sessions (no shared business state).

Full responsibility split, the proxy/internal-auth helpers, and the list of `/api/internal/*` endpoints live in [`docs/architecture.md`](./docs/architecture.md). When adding a new endpoint, follow the checklist in that doc.

## Webhooks

The **shopify-app** receives Shopify webhooks and syncs data to the shared database. The field-app queries this database for up-to-date product, company, and order information.

Webhook subscriptions are configured in `apps/shopify-app/shopify.app.toml`:

| Topic | Purpose |
|-------|---------|
| `products/create`, `products/update`, `products/delete` | Sync product catalog |
| `companies/create`, `companies/update`, `companies/delete` | Sync B2B companies |
| `company_locations/*` | Sync company locations |
| `orders/create`, `orders/updated` | Sync order status |
| `app/uninstalled` | Clean up on app removal |

## Deployment

### Render (Recommended)

This monorepo is configured for Render deployment using a Blueprint (`render.yaml`). Both apps are deployed as separate web services but share the database and Redis.

**How it works:**
- Render runs builds from the **repository root** (not individual app directories)
- npm workspaces resolve the shared `@field-sales/shared` package automatically
- Each service uses `--workspace=apps/<app-name>` flags to build/start the specific app

**Setup:**

1. Connect your repository to Render
2. Go to **Blueprints** → **New Blueprint Instance**
3. Select your repo and Render will detect `render.yaml`
4. Configure secret environment variables (marked `sync: false`):

| Variable | Service | Description |
|----------|---------|-------------|
| `SHOPIFY_API_KEY` | shopify-app | From Shopify Partner Dashboard |
| `SHOPIFY_API_SECRET` | shopify-app | From Shopify Partner Dashboard |
| `SHOPIFY_APP_URL` | shopify-app | Your shopify-app Render public URL (used by Shopify webhooks/embedded admin) |
| `APP_SECRET` | **both** services (same value) | Shared secret authenticating field-app→shopify-app proxy calls |
| `SHOPIFY_APP_URL` | **field-app** | Where field-app proxies mutations. Use the **private** internal hostname (e.g. `http://field-sales-shopify-app:3000`) so traffic stays inside Render's private network |
| `JWT_SECRET` | field-app | Rep session signing |

5. Click **Apply** to deploy

**What gets provisioned:**
- `field-sales-shopify-app` - React Router web service
- `field-sales-field-app` - Next.js web service
- `field-sales-db` - PostgreSQL database
- `field-sales-redis` - Redis instance

**Build commands used:**
```bash
# Shopify App
npm install && npm run build --workspace=apps/shopify-app && npm run setup --workspace=apps/shopify-app

# Field App
npm install && npm run build --workspace=apps/field-app && npx prisma generate --schema=apps/field-app/prisma/schema.prisma
```

### Manual Deployment

For other platforms, build from the monorepo root using workspace commands:

**Shopify App:**
```bash
# From repo root
npm install
npm run build --workspace=apps/shopify-app
npm run setup --workspace=apps/shopify-app   # Prisma generate + migrate
npm run start --workspace=apps/shopify-app
```

**Field App:**
```bash
# From repo root
npm install
npm run build --workspace=apps/field-app
npx prisma generate --schema=apps/field-app/prisma/schema.prisma
npm run start --workspace=apps/field-app
```

> **Note:** Always run `npm install` from the repo root to ensure the shared package is linked correctly.

## Development Commands

```bash
# Run both apps (separate terminals)
npm run dev:shopify
npm run dev:field

# Type checking
npm run typecheck

# Linting
npm run lint

# Database operations (field-app)
cd apps/field-app
npm run db:generate    # Generate Prisma client
npm run db:migrate     # Run migrations
npm run db:push        # Push schema changes
npm run db:seed        # Seed sample data
```

## Troubleshooting

### "No sales reps found"
Run `npm run db:seed` in `apps/field-app` to create sample data.

### Prisma client errors
Ensure both apps have generated their Prisma clients:
```bash
cd apps/shopify-app && npx prisma generate
cd apps/field-app && npx prisma generate
```

### 401 Unauthorized in field-app
Check that `JWT_SECRET` is set in your `.env` file.

### Database connection errors
Verify `DATABASE_URL` is correct and PostgreSQL is running.

## License

Proprietary - All rights reserved.
