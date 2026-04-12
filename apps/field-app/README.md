# Field Sales App

Mobile-first web application for field sales representatives to manage accounts and place orders.

## Overview

This is a Next.js 16 application that serves as the primary interface for sales reps. It connects to a shared PostgreSQL database and communicates with Shopify via stored access tokens.

## Tech Stack

- **Framework**: Next.js 16 (App Router, Server Components)
- **Language**: TypeScript (strict mode)
- **Styling**: Tailwind CSS (mobile-first)
- **Database**: PostgreSQL via Prisma ORM
- **Cache**: Redis (sessions, rate limiting)
- **Authentication**: JWT-based sessions

## Getting Started

### Prerequisites

- Node.js >= 20.0.0
- PostgreSQL 14+
- Redis 6+

### Installation

```bash
# From the monorepo root
npm install

# Generate Prisma client
cd apps/field-app
npx prisma generate
```

### Environment Variables

Copy `.env.example` to `.env` and configure:

```env
# Database
DATABASE_URL="postgresql://user:password@localhost:5432/field_sales_manager"

# Redis
REDIS_URL="redis://localhost:6379"

# Authentication
JWT_SECRET="your-secret-minimum-32-characters"
JWT_EXPIRES_IN="1h"
REFRESH_TOKEN_EXPIRES_IN="7d"

# Shopify (for webhooks)
SHOPIFY_API_SECRET=""
```

### Development

```bash
# From monorepo root
npm run dev:field

# Or from this directory
npm run dev
```

The app runs on http://localhost:3001

### Database Commands

```bash
npm run db:generate    # Generate Prisma client
npm run db:migrate     # Run migrations
npm run db:push        # Push schema changes
npm run db:seed        # Seed sample data
```

## Project Structure

```
src/
├── app/                    # Next.js App Router
│   ├── (app)/             # Authenticated routes
│   │   ├── dashboard/     # Dashboard page
│   │   ├── companies/     # Company management
│   │   ├── orders/        # Order history
│   │   └── account/       # Sales rep account
│   ├── api/               # API routes
│   │   ├── auth/          # Authentication endpoints
│   │   ├── companies/     # Company API
│   │   ├── cart/          # Cart operations
│   │   ├── orders/        # Order management
│   │   ├── products/      # Product catalog
│   │   └── webhooks/      # Shopify webhooks
│   └── login/             # Login page
├── components/            # React components
│   ├── ui/               # Base UI components
│   ├── companies/        # Company-related components
│   ├── cart/             # Cart components
│   └── orders/           # Order components
├── lib/                   # Shared utilities
│   ├── auth/             # Authentication helpers
│   ├── db/               # Prisma client
│   ├── redis/            # Redis client
│   ├── shopify/          # Shopify API client
│   └── utils/            # General utilities
├── services/             # Business logic
│   ├── product-sync.ts   # Product synchronization
│   └── promotions.ts       # Discount calculations
├── types/                # TypeScript definitions
└── proxy.ts              # Auth middleware
```

## Key Features

### Authentication
- JWT-based authentication for sales reps
- Refresh token rotation
- Role-based access (Rep, Manager, Admin)

### Accounts
- Territory-based company filtering
- Company details with contacts and locations
- Order history per company

### Products
- Synced from Shopify via webhooks
- Cached locally for fast access
- Tag-based enablement for field app

### Cart & Orders
- Cart sessions per rep/company
- Promotion engine for line item discounts
- DraftOrder creation in Shopify
- Order status tracking

### Webhooks
- `products/create`, `products/update`, `products/delete`
- `orders/create`, `orders/updated`, `orders/paid`, `orders/cancelled`

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/auth/login` | POST | Authenticate sales rep |
| `/api/auth/refresh` | POST | Refresh JWT token |
| `/api/auth/logout` | POST | End session |
| `/api/dashboard` | GET | Dashboard metrics |
| `/api/companies` | GET | List companies |
| `/api/companies/[id]` | GET | Company details |
| `/api/products` | GET | Product catalog |
| `/api/cart` | GET/POST/PATCH/DELETE | Cart operations |
| `/api/orders` | GET/POST | List/create orders |
| `/api/orders/[id]` | GET | Order details |

## Multi-Tenant Architecture

Each Shopify store is a tenant (`shopId`). All queries are scoped by:
1. `shopId` - from the rep's session
2. `repId` - the authenticated rep
3. `role` - determines data access (rep sees assigned companies, admin sees all)

## Development Login

In development mode, visit `/login` and select a sales rep to authenticate without credentials. This bypasses password verification for faster testing.

## Deployment

This app is part of a monorepo and should be built from the **repository root** to ensure the shared `@field-sales/shared` package is resolved correctly.

### Production Build (from monorepo root)

```bash
# From repository root
npm install
npm run build --workspace=apps/field-app
npx prisma generate --schema=apps/field-app/prisma/schema.prisma
npm run start --workspace=apps/field-app
```

### Render Deployment

See the root `render.yaml` for the full Blueprint configuration. This app is deployed as the `field-sales-field-app` service.

**Build command:**
```bash
npm install && npm run build --workspace=apps/field-app && npx prisma generate --schema=apps/field-app/prisma/schema.prisma
```

**Start command:**
```bash
npm run start --workspace=apps/field-app
```

**Required environment variables:**
- `DATABASE_URL` - PostgreSQL connection string
- `REDIS_URL` - Redis connection string
- `JWT_SECRET` - Secret for JWT signing (auto-generated by Render)
- `SHOPIFY_API_SECRET` - For webhook signature verification
