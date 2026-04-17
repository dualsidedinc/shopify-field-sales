// Re-export Prisma client
export { prisma, default } from "./client";

// Re-export Prisma namespace for advanced types (Decimal, etc.)
export { Prisma } from "@prisma/client";

// Re-export all Prisma generated types (models, enums)
export type {
  // Models
  Session,
  Shop,
  SalesRep,
  Territory,
  TerritoryZipcode,
  TerritoryState,
  RepTerritory,
  Company,
  CompanyLocation,
  CompanyContact,
  Catalog,
  CatalogItem,
  CompanyLocationCatalog,
  PaymentMethod,
  CartSession,
  Order,
  OrderTimelineEvent,
  OrderLineItem,
  Product,
  ProductVariant,
  ShippingMethod,
  Promotion,
  RepQuota,
  BillingPeriod,
  BilledOrder,
  LeadFormField,
  Lead,
  // Enums
  PaymentStrategy,
  BillingPlan,
  BillingStatus,
  RepRole,
  PaymentTerms,
  SyncStatus,
  CatalogStatus,
  PaymentProvider,
  CartStatus,
  OrderStatus,
  AuthorType,
  ProductStatus,
  PromotionType,
  PromotionScope,
  LeadFieldType,
  LeadStatus,
} from "@prisma/client";
