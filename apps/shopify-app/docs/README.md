# Shopify App Documentation

Shopify Admin embedded application for merchants to configure Field Sales Manager.

## Overview

This app runs inside the Shopify Admin and handles:
- Sales rep and territory management
- Product catalog configuration
- Order processing and Shopify integration
- Company/B2B customer management
- Payment terms and vaulted card processing
- Subscription billing

## Documentation Index

| Document | Description |
|----------|-------------|
| **[Architecture](../../../docs/architecture.md)** | **Cross-app responsibility split + internal API pattern — read first** |
| [Orders](./orders.md) | Order lifecycle, payment terms, vaulted cards, webhooks |
| [OrderForm](./order-form.md) | Order creation/edit form with payment selection |
| [Promotions](./promotions.md) | Promotion types, scopes, real-time evaluation |
| [Catalogs](./catalogs.md) | B2B catalog pricing and product availability |
| [Pickers](./pickers.md) | Company, Contact, Location picker components |
| [Territories](./territories.md) | Geographic regions, location assignment |
| [Companies](./companies.md) | B2B accounts, contacts, locations, payment methods |
| [Leads](./leads.md) | Public lead capture form, form builder, Google Places |
| [Sales Reps](./sales-reps.md) | Rep management, territory access |
| [Billing](./billing.md) | App subscription plans, usage tracking |
| **[Queue](./queue.md)** | **Generic background job queue (webhooks, API calls, imports, scheduled actions)** |

## Architecture

### Stack
- React Router 7 (formerly Remix) with Vite
- TypeScript
- Shopify Polaris Web Components
- Prisma ORM with PostgreSQL

### Key Directories
```
app/
├── routes/                       # React Router route files
│   ├── app.*.tsx                # Embedded admin UI routes
│   ├── api.internal.*.tsx       # Internal API for field-app proxy calls
│   ├── api.cron.*.tsx           # Scheduled jobs
│   └── webhooks.*.tsx           # Shopify webhook handlers
├── services/                     # Business logic (shared by UI and internal API)
├── lib/
│   └── internal-auth.server.ts  # Validates field-app proxy requests
├── components/                   # Shared components
├── db.server.ts                  # Prisma client
└── shopify.server.ts             # Shopify auth configuration
```

### Shopify Integration

This app is the **only** component that interacts with Shopify APIs:
- GraphQL Admin API for companies, orders, products, customers
- Webhooks for real-time updates
- Billing API for subscriptions

### Internal API (field-app proxy target)

Field-app proxies all mutations to `/api/internal/*` routes here. Each one validates the shared `APP_SECRET` + rep identity headers via `requireInternalAuth`. See [`docs/architecture.md`](../../../docs/architecture.md) for the full pattern.

### Database
- Shared PostgreSQL with field-app
- Standard Prisma client: `@prisma/client`
- Both apps share the same schema

## Quick Reference

### Routes

**Embedded admin UI** (`authenticate.admin`):
- `app._index.tsx` - Dashboard
- `app.reps.*` - Sales rep management
- `app.territories.*` - Territory management
- `app.companies.*` - Company management
- `app.orders.*` - Order management
- `app.products.*` - Product configuration
- `app.leads.*` - Lead capture and form builder
- `app.billing.*` - Billing management

**Internal API for field-app** (`requireInternalAuth`):
- `api.internal.orders.*` - create/replace/delete + submit/approve/decline/comments
- `api.internal.tax.calculate` - Shopify draftOrderCalculate
- `api.internal.reps.*` - rep CRUD + territory assignment
- `api.internal.territories.*` - territory CRUD
- `api.internal.companies.*` - company CRUD + contacts + payment-methods
- `api.internal.profile` - rep self-update

**Other:**
- `proxy.lead-form.tsx` - Public lead form (App Proxy)
- `webhooks.*` - Shopify webhook handlers
- `api.cron.*` - Scheduled jobs (cron secret auth)

### Services
| Service | Purpose |
|---------|---------|
| `order.server.ts` | Order CRUD, Shopify sync |
| `promotion.server.ts` | Promotion CRUD, evaluation |
| `catalog.server.ts` | B2B catalog sync, pricing lookup |
| `product.server.ts` | Product queries with catalog pricing |
| `territory.server.ts` | Territory management |
| `company.server.ts` | Company import/sync |
| `companySync.server.ts` | Full company sync (contacts, locations, catalogs) |
| `salesRep.server.ts` | Rep management |
| `billing.server.ts` | Subscription billing |
| `customer.server.ts` | Customer sync |
| `lead.server.ts` | Lead form fields, submissions |
| `metafield.server.ts` | Shopify metafield definitions and order metadata |
| `webhook.server.ts` | Webhook processing |

## Scheduled Jobs (GitHub Actions)

Located in `.github/workflows/`:

| Workflow | Schedule | Description |
|----------|----------|-------------|
| `monthly-billing.yml` | 1st of month | Process monthly usage billing |
| `daily-payments.yml` | Daily 6:00 UTC | Charge due orders / send invoices |

**Required Secrets:**
- `SHOPIFY_APP_URL` - Your deployed app URL
- `APP_SECRET` - Secret for authenticating cron requests

## Development

```bash
npm run dev           # Start dev server
shopify app dev       # Alternative with Shopify CLI
shopify app deploy    # Deploy config changes
npx prisma generate   # Generate Prisma client
```
