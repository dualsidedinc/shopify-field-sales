import { authenticate } from "../shopify.server";
import { prisma } from "@field-sales/database";
import type { Shop } from "@prisma/client";
import { getShopifyCompaniesCount } from "./company.server";

export interface AuthenticatedShop {
  shop: Shop;
  session: Awaited<ReturnType<typeof authenticate.admin>>["session"];
  admin: Awaited<ReturnType<typeof authenticate.admin>>["admin"];
  redirect: Awaited<ReturnType<typeof authenticate.admin>>["redirect"];
}

/**
 * Authenticates the request and returns the shop record.
 * Use this in loaders and actions to get the authenticated shop.
 */
export async function getAuthenticatedShop(
  request: Request
): Promise<AuthenticatedShop> {
  const { session, admin, redirect } = await authenticate.admin(request);

  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: session.shop },
  });

  if (!shop) {
    throw new Response("Shop not found", { status: 404 });
  }

  return { shop, session, admin, redirect };
}

/**
 * Gets the shop if it exists, returns null otherwise.
 * Use this when you want to handle missing shop gracefully.
 */
export async function getShopOrNull(
  request: Request
): Promise<{
  shop: Shop | null;
  session: Awaited<ReturnType<typeof authenticate.admin>>["session"];
  admin: Awaited<ReturnType<typeof authenticate.admin>>["admin"];
}> {
  const { session, admin } = await authenticate.admin(request);

  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: session.shop },
  });

  return { shop, session, admin };
}

export interface TopSalesRep {
  id: string;
  name: string;
  revenueCents: number;
  orderCount: number;
}

export interface TopCompany {
  id: string;
  name: string;
  revenueCents: number;
  orderCount: number;
}

export interface DashboardMetrics {
  accounts: { value: number; change: number; changePercent: number };
  orders: { value: number; change: number; changePercent: number };
  revenue: { value: number; change: number; changePercent: number };
  revenuePerRep: { value: number; change: number; changePercent: number };
  pendingOrders: number;
  pendingRevenue: number;
  activeReps: number;
}

export interface DashboardData {
  shopName: string;
  companiesCount: number;
  hasManagedCompanies: boolean;
  shop: {
    id: string;
    isActive: boolean;
  } | null;
  metrics: DashboardMetrics;
  topSalesReps: TopSalesRep[];
  topCompanies: TopCompany[];
}

/**
 * Calculate percentage change between two values.
 * Returns 0 if previous value is 0 (avoid division by zero).
 */
function calculatePercentChange(current: number, previous: number): number {
  if (previous === 0) {
    return current > 0 ? 100 : 0;
  }
  return Math.round(((current - previous) / previous) * 100);
}

/**
 * Get all data needed for the dashboard.
 */
export async function getDashboardData(request: Request): Promise<DashboardData> {
  const { admin, session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const startDate = url.searchParams.get("startDate");
  const endDate = url.searchParams.get("endDate");

  // Get shop info from database
  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: session.shop },
    select: {
      id: true,
      isActive: true,
      hasManagedCompanies: true,
    },
  });

  // Get companies count from Shopify
  const companiesCount = await getShopifyCompaniesCount(admin);

  // Default metrics for new installations or when no data
  const defaultMetrics: DashboardMetrics = {
    accounts: { value: 0, change: 0, changePercent: 0 },
    orders: { value: 0, change: 0, changePercent: 0 },
    revenue: { value: 0, change: 0, changePercent: 0 },
    revenuePerRep: { value: 0, change: 0, changePercent: 0 },
    pendingOrders: 0,
    pendingRevenue: 0,
    activeReps: 0,
  };

  // Fetch leaderboards and metrics if we have a shop and date range
  let topSalesReps: TopSalesRep[] = [];
  let topCompanies: TopCompany[] = [];
  let metrics = defaultMetrics;

  if (shop?.id && startDate && endDate) {
    const currentStart = new Date(startDate);
    const currentEnd = new Date(endDate + "T23:59:59.999Z");

    // Calculate previous period (same duration, immediately before)
    const periodMs = currentEnd.getTime() - currentStart.getTime();
    const previousStart = new Date(currentStart.getTime() - periodMs);
    const previousEnd = new Date(currentStart.getTime() - 1);

    const currentDateFilter = {
      placedAt: { gte: currentStart, lte: currentEnd },
    };
    const previousDateFilter = {
      placedAt: { gte: previousStart, lte: previousEnd },
    };

    // Statuses for "placed" orders (not draft/cancelled)
    const placedStatuses: ("AWAITING_REVIEW" | "PENDING" | "PAID")[] = ["AWAITING_REVIEW", "PENDING", "PAID"];

    // Run all queries in parallel
    const [
      // Current period metrics
      currentOrderCount,
      currentRevenue,
      // Previous period metrics
      previousOrderCount,
      previousRevenue,
      // Pending orders
      pendingOrdersData,
      // Active accounts (companies with orders in period)
      currentActiveAccounts,
      previousActiveAccounts,
      // Active sales reps
      activeRepsCount,
      // Top sales reps
      salesRepStats,
      // Top companies
      companyStats,
    ] = await Promise.all([
      // Current period order count
      prisma.order.count({
        where: { shopId: shop.id, status: { in: placedStatuses }, ...currentDateFilter },
      }),
      // Current period revenue
      prisma.order.aggregate({
        where: { shopId: shop.id, status: { in: placedStatuses }, ...currentDateFilter },
        _sum: { totalCents: true },
      }),
      // Previous period order count
      prisma.order.count({
        where: { shopId: shop.id, status: { in: placedStatuses }, ...previousDateFilter },
      }),
      // Previous period revenue
      prisma.order.aggregate({
        where: { shopId: shop.id, status: { in: placedStatuses }, ...previousDateFilter },
        _sum: { totalCents: true },
      }),
      // Pending orders and revenue
      prisma.order.aggregate({
        where: { shopId: shop.id, status: "PENDING" },
        _count: { _all: true },
        _sum: { totalCents: true },
      }),
      // Current period active accounts
      prisma.order.groupBy({
        by: ["companyId"],
        where: { shopId: shop.id, status: { in: placedStatuses }, ...currentDateFilter },
      }),
      // Previous period active accounts
      prisma.order.groupBy({
        by: ["companyId"],
        where: { shopId: shop.id, status: { in: placedStatuses }, ...previousDateFilter },
      }),
      // Active sales reps count
      prisma.salesRep.count({
        where: { shopId: shop.id, isActive: true },
      }),
      // Top 10 Sales Reps by Revenue
      prisma.order.groupBy({
        by: ["salesRepId"],
        where: { shopId: shop.id, status: { in: placedStatuses }, ...currentDateFilter },
        _sum: { totalCents: true },
        _count: { _all: true },
        orderBy: { _sum: { totalCents: "desc" } },
        take: 10,
      }),
      // Top 10 Companies by Revenue
      prisma.order.groupBy({
        by: ["companyId"],
        where: { shopId: shop.id, status: { in: placedStatuses }, ...currentDateFilter },
        _sum: { totalCents: true },
        _count: { _all: true },
        orderBy: { _sum: { totalCents: "desc" } },
        take: 10,
      }),
    ]);

    // Calculate metrics
    const currentRevenueValue = currentRevenue._sum?.totalCents || 0;
    const previousRevenueValue = previousRevenue._sum?.totalCents || 0;
    const currentAccountCount = currentActiveAccounts.length;
    const previousAccountCount = previousActiveAccounts.length;

    // Revenue per rep (avoid division by zero)
    const currentRevenuePerRep = activeRepsCount > 0 ? Math.round(currentRevenueValue / activeRepsCount) : 0;
    const previousRevenuePerRep = activeRepsCount > 0 ? Math.round(previousRevenueValue / activeRepsCount) : 0;

    metrics = {
      accounts: {
        value: currentAccountCount,
        change: currentAccountCount - previousAccountCount,
        changePercent: calculatePercentChange(currentAccountCount, previousAccountCount),
      },
      orders: {
        value: currentOrderCount,
        change: currentOrderCount - previousOrderCount,
        changePercent: calculatePercentChange(currentOrderCount, previousOrderCount),
      },
      revenue: {
        value: currentRevenueValue,
        change: currentRevenueValue - previousRevenueValue,
        changePercent: calculatePercentChange(currentRevenueValue, previousRevenueValue),
      },
      revenuePerRep: {
        value: currentRevenuePerRep,
        change: currentRevenuePerRep - previousRevenuePerRep,
        changePercent: calculatePercentChange(currentRevenuePerRep, previousRevenuePerRep),
      },
      pendingOrders: pendingOrdersData._count?._all || 0,
      pendingRevenue: pendingOrdersData._sum?.totalCents || 0,
      activeReps: activeRepsCount,
    };

    // Get sales rep names
    const repIds = salesRepStats.map((s) => s.salesRepId);
    const reps = await prisma.salesRep.findMany({
      where: { id: { in: repIds } },
      select: { id: true, firstName: true, lastName: true },
    });
    const repMap = new Map(reps.map((r) => [r.id, `${r.firstName} ${r.lastName}`]));

    topSalesReps = salesRepStats.map((s) => ({
      id: s.salesRepId,
      name: repMap.get(s.salesRepId) || "Unknown",
      revenueCents: s._sum?.totalCents || 0,
      orderCount: (s._count && typeof s._count === "object" && "_all" in s._count ? s._count._all : 0) as number,
    }));

    // Get company names
    const companyIds = companyStats.map((c) => c.companyId);
    const companies = await prisma.company.findMany({
      where: { id: { in: companyIds } },
      select: { id: true, name: true },
    });
    const companyMap = new Map(companies.map((c) => [c.id, c.name]));

    topCompanies = companyStats.map((c) => ({
      id: c.companyId,
      name: companyMap.get(c.companyId) || "Unknown",
      revenueCents: c._sum?.totalCents || 0,
      orderCount: (c._count && typeof c._count === "object" && "_all" in c._count ? c._count._all : 0) as number,
    }));
  }

  return {
    shopName: session.shop.replace(".myshopify.com", ""),
    companiesCount,
    hasManagedCompanies: shop?.hasManagedCompanies || false,
    shop: shop ? { id: shop.id, isActive: shop.isActive } : null,
    metrics,
    topSalesReps,
    topCompanies,
  };
}
