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

## Architecture

### Stack
- React Router 7 (formerly Remix) with Vite
- TypeScript
- Shopify Polaris Web Components
- Prisma ORM with PostgreSQL

### Key Directories
```
app/
├── routes/              # React Router route files
│   ├── app.*.tsx       # Authenticated app routes
│   └── webhooks.*.tsx  # Webhook handlers
├── services/           # Business logic
├── components/         # Shared components
├── db.server.ts        # Prisma client
└── shopify.server.ts   # Shopify auth configuration
```

### Shopify Integration

This app is the **only** component that interacts with Shopify APIs:
- GraphQL Admin API for companies, orders, products, customers
- Webhooks for real-time updates
- Billing API for subscriptions

### Database
- Shared PostgreSQL with field-app
- Standard Prisma client: `@prisma/client`
- Both apps share the same schema

## Quick Reference

### Routes
- `app._index.tsx` - Dashboard
- `app.reps.*` - Sales rep management
- `app.territories.*` - Territory management
- `app.companies.*` - Company management
- `app.orders.*` - Order management
- `app.products.*` - Product configuration
- `app.leads.*` - Lead capture and form builder
- `app.billing.*` - Billing management
- `proxy.lead-form.tsx` - Public lead form (App Proxy)

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
