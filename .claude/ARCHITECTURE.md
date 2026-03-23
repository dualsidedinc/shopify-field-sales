# System Architecture

## High-Level Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              MERCHANT SIDE                                   │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                     Shopify Admin                                    │    │
│  │  ┌──────────────────┐    ┌──────────────────┐                       │    │
│  │  │ Shopify Embedded │    │   Shopify B2B    │                       │    │
│  │  │   Config App     │◄───│   Companies      │                       │    │
│  │  │  (Polaris/Vite)  │    │   Products       │                       │    │
│  │  └────────┬─────────┘    │   Orders         │                       │    │
│  │           │              └────────┬─────────┘                       │    │
│  └───────────┼───────────────────────┼─────────────────────────────────┘    │
│              │                       │                                       │
└──────────────┼───────────────────────┼───────────────────────────────────────┘
               │                       │
               │ OAuth Install         │ Admin GraphQL API
               │ Tenant Config         │ Webhooks
               ▼                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                            PLATFORM SIDE                                     │
│                                                                              │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                         Main App (Next.js)                             │  │
│  │                                                                        │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐   │  │
│  │  │  Dashboard  │  │  Accounts   │  │    Cart     │  │   Orders    │   │  │
│  │  │    Page     │  │    List     │  │   Builder   │  │   History   │   │  │
│  │  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘   │  │
│  │                                                                        │  │
│  │  ┌─────────────────────────────────────────────────────────────────┐  │  │
│  │  │                      Service Layer                               │  │  │
│  │  │  TerritoryService | CompanyService | CartService | OrderService │  │  │
│  │  └─────────────────────────────────────────────────────────────────┘  │  │
│  │                                                                        │  │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────────┐ │  │
│  │  │   Shopify    │  │   Payment    │  │      Multi-Tenant            │ │  │
│  │  │   Client     │  │  Provider    │  │      Middleware              │ │  │
│  │  └──────────────┘  └──────────────┘  └──────────────────────────────┘ │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│              │                │                      │                       │
│              ▼                ▼                      ▼                       │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐           │
│  │   PostgreSQL     │  │     Redis        │  │     Stripe       │           │
│  │   (Prisma ORM)   │  │   (Cache/        │  │   (Payment       │           │
│  │                  │  │    Sessions)     │  │    Vaulting)     │           │
│  └──────────────────┘  └──────────────────┘  └──────────────────┘           │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
               ▲
               │
               │ Mobile-First Web App
               │
┌─────────────────────────────────────────────────────────────────────────────┐
│                              FIELD REP SIDE                                  │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                    Sales Rep (Mobile Browser)                        │    │
│  │                                                                      │    │
│  │    ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐          │    │
│  │    │Dashboard │  │ Accounts │  │  Orders  │  │   More   │          │    │
│  │    └──────────┘  └──────────┘  └──────────┘  └──────────┘          │    │
│  │                  (Bottom Navigation Bar)                            │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Data Flow Diagrams

### 1. App Installation Flow

```
Merchant                Shopify            Shopify App         PostgreSQL
   │                       │                    │                  │
   │  Install App          │                    │                  │
   ├──────────────────────►│                    │                  │
   │                       │  OAuth Redirect    │                  │
   │                       ├───────────────────►│                  │
   │                       │                    │                  │
   │                       │  Exchange Code     │                  │
   │                       │◄───────────────────┤                  │
   │                       │                    │                  │
   │                       │  Access Token      │                  │
   │                       ├───────────────────►│                  │
   │                       │                    │                  │
   │                       │                    │  Create Tenant   │
   │                       │                    ├─────────────────►│
   │                       │                    │                  │
   │                       │                    │  Register        │
   │                       │                    │  Webhooks        │
   │                       │◄───────────────────┤                  │
   │                       │                    │                  │
   │  Config UI            │                    │                  │
   │◄──────────────────────────────────────────┤                  │
   │                       │                    │                  │
```

### 2. Rep Authentication Flow

```
Sales Rep              Main App            PostgreSQL           Redis
   │                      │                    │                  │
   │  Login (email/pass)  │                    │                  │
   ├─────────────────────►│                    │                  │
   │                      │  Verify Creds      │                  │
   │                      ├───────────────────►│                  │
   │                      │                    │                  │
   │                      │  Rep + Tenant      │                  │
   │                      │◄───────────────────┤                  │
   │                      │                    │                  │
   │                      │  Generate JWT      │                  │
   │                      │  (tenant_id,       │                  │
   │                      │   rep_id, role)    │                  │
   │                      │                    │                  │
   │                      │  Store Refresh     │                  │
   │                      ├──────────────────────────────────────►│
   │                      │                    │                  │
   │  JWT + Refresh Token │                    │                  │
   │◄─────────────────────┤                    │                  │
   │                      │                    │                  │
```

### 3. Company List Query Flow

```
Sales Rep              Main App            PostgreSQL         Shopify
   │                      │                    │                 │
   │  GET /accounts       │                    │                 │
   ├─────────────────────►│                    │                 │
   │                      │                    │                 │
   │   (JWT in header)    │  Get Rep           │                 │
   │                      │  Territories       │                 │
   │                      ├───────────────────►│                 │
   │                      │                    │                 │
   │                      │  Get Companies     │                 │
   │                      │  by Territory      │                 │
   │                      │  (from company_    │                 │
   │                      │   sync table)      │                 │
   │                      │◄───────────────────┤                 │
   │                      │                    │                 │
   │                      │  [Optional: Enrich │                 │
   │                      │   with Shopify     │                 │
   │                      │   live data]       │                 │
   │                      ├────────────────────────────────────►│
   │                      │                    │                 │
   │  Company List        │                    │                 │
   │◄─────────────────────┤                    │                 │
   │                      │                    │                 │
```

### 4. Order Placement Flow

```
Sales Rep     Main App     PostgreSQL     Redis       Shopify      Stripe
   │             │             │            │            │            │
   │ Build Cart  │             │            │            │            │
   ├────────────►│             │            │            │            │
   │             │ Save Cart   │            │            │            │
   │             ├────────────►│            │            │            │
   │             │             │            │            │            │
   │ Place Order │             │            │            │            │
   ├────────────►│             │            │            │            │
   │             │             │            │            │            │
   │             │ Get Tenant  │            │            │            │
   │             ├────────────►│            │            │            │
   │             │             │            │            │            │
   │             │ [If Stripe Payment]      │            │            │
   │             ├───────────────────────────────────────────────────►│
   │             │             │            │            │ Charge     │
   │             │◄───────────────────────────────────────────────────┤
   │             │             │            │            │            │
   │             │ Create Draft Order       │            │            │
   │             ├──────────────────────────────────────►│            │
   │             │             │            │            │            │
   │             │ Complete Draft Order     │            │            │
   │             ├──────────────────────────────────────►│            │
   │             │             │            │            │            │
   │             │ [If Stripe] Mark as Paid │            │            │
   │             ├──────────────────────────────────────►│            │
   │             │             │            │            │            │
   │             │ Save Order Ref           │            │            │
   │             ├────────────►│            │            │            │
   │             │             │            │            │            │
   │ Order       │             │            │            │            │
   │ Confirmed   │             │            │            │            │
   │◄────────────┤             │            │            │            │
```

### 5. Webhook Sync Flow

```
Shopify              Main App            PostgreSQL          Redis
   │                    │                    │                 │
   │ companies/create   │                    │                 │
   ├───────────────────►│                    │                 │
   │                    │                    │                 │
   │                    │ Verify HMAC        │                 │
   │                    │                    │                 │
   │                    │ Upsert to          │                 │
   │                    │ company_sync       │                 │
   │                    ├───────────────────►│                 │
   │                    │                    │                 │
   │                    │ Auto-assign        │                 │
   │                    │ Territory (by zip) │                 │
   │                    ├───────────────────►│                 │
   │                    │                    │                 │
   │                    │ Invalidate Cache   │                 │
   │                    ├────────────────────────────────────►│
   │                    │                    │                 │
   │ 200 OK             │                    │                 │
   │◄───────────────────┤                    │                 │
```

## Component Architecture

### Main App Components

```
app/
├── (auth)/
│   └── login/
│       └── page.tsx          ← Login form
│
├── (app)/                    ← Authenticated routes
│   ├── layout.tsx            ← Bottom nav, auth check
│   │
│   ├── dashboard/
│   │   └── page.tsx          ← KPIs, recent orders
│   │
│   ├── accounts/
│   │   ├── page.tsx          ← Company list (filtered)
│   │   └── [id]/
│   │       ├── page.tsx      ← Company detail
│   │       ├── order/
│   │       │   └── page.tsx  ← Cart builder
│   │       └── payment/
│   │           └── page.tsx  ← Payment methods
│   │
│   ├── orders/
│   │   ├── page.tsx          ← Order history
│   │   └── [id]/
│   │       └── page.tsx      ← Order detail
│   │
│   └── settings/
│       └── page.tsx          ← Rep profile
│
└── api/
    ├── auth/
    │   ├── login/route.ts
    │   ├── logout/route.ts
    │   └── refresh/route.ts
    │
    ├── companies/
    │   ├── route.ts          ← List companies
    │   └── [id]/route.ts     ← Company detail
    │
    ├── cart/
    │   └── route.ts          ← Cart operations
    │
    ├── orders/
    │   ├── route.ts          ← Create order, list orders
    │   └── [id]/route.ts     ← Order detail
    │
    ├── products/
    │   └── route.ts          ← Product catalog
    │
    ├── payments/
    │   └── route.ts          ← Payment method ops
    │
    └── webhooks/
        └── shopify/route.ts  ← Webhook ingestion
```

## Multi-Tenant Resolution

```
┌─────────────────────────────────────────────────────────────────┐
│                         Request Flow                             │
│                                                                  │
│  Request                                                         │
│     │                                                            │
│     ▼                                                            │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                    Middleware                             │   │
│  │                                                           │   │
│  │  1. Extract JWT from Authorization header                 │   │
│  │  2. Verify JWT signature                                  │   │
│  │  3. Decode payload: { tenant_id, rep_id, role }          │   │
│  │  4. Fetch tenant from DB (cached in Redis)               │   │
│  │  5. Inject into request context:                         │   │
│  │     - tenant (with decrypted access_token)               │   │
│  │     - rep                                                 │   │
│  │     - shopifyClient (pre-configured for tenant)          │   │
│  │                                                           │   │
│  └──────────────────────────────────────────────────────────┘   │
│     │                                                            │
│     ▼                                                            │
│  Route Handler (has access to tenant context)                   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Payment Provider Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    PaymentProvider Interface                     │
│                                                                  │
│  interface PaymentProvider {                                     │
│    vaultPaymentMethod(companyId, paymentDetails): Promise<...>  │
│    getPaymentMethods(companyId): Promise<PaymentMethod[]>       │
│    processOrderPayment(orderId, methodId, amount): Promise<...> │
│    removePaymentMethod(methodId): Promise<void>                 │
│  }                                                               │
│                                                                  │
└──────────────────────────┬──────────────────────────────────────┘
                           │
         ┌─────────────────┼─────────────────┐
         │                 │                 │
         ▼                 ▼                 ▼
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│ ShopifyTerms    │ │ StripeVault     │ │ ShopifyVault    │
│ Provider        │ │ Provider        │ │ Provider        │
│                 │ │                 │ │ (Future)        │
│ - Net 30/60     │ │ - Card vaulting │ │                 │
│ - Shopify       │ │ - Charge card   │ │                 │
│   sends invoice │ │ - Mark paid     │ │                 │
└─────────────────┘ └─────────────────┘ └─────────────────┘
```

## Hosting Architecture (Render)

```
┌─────────────────────────────────────────────────────────────────┐
│                         Render Platform                          │
│                                                                  │
│  ┌───────────────┐  ┌───────────────┐                           │
│  │ Shopify App   │  │   Main App    │                           │
│  │ Web Service   │  │ Web Service   │                           │
│  │               │  │               │                           │
│  │ Node.js       │  │ Next.js       │                           │
│  │ Port 3000     │  │ Port 3001     │                           │
│  └───────┬───────┘  └───────┬───────┘                           │
│          │                  │                                    │
│          └────────┬─────────┘                                    │
│                   │                                              │
│                   ▼                                              │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │              Render Private Network                      │    │
│  │                                                          │    │
│  │  ┌───────────────────┐    ┌───────────────────┐         │    │
│  │  │    PostgreSQL     │    │      Redis        │         │    │
│  │  │    Database       │    │      Cache        │         │    │
│  │  │                   │    │                   │         │    │
│  │  │  internal:5432    │    │  internal:6379    │         │    │
│  │  └───────────────────┘    └───────────────────┘         │    │
│  │                                                          │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```
