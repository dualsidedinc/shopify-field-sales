import prisma from "../db.server";
import { getRepQuotaProgress, type QuotaProgress } from "./quota.server";
import type { RepRole } from "../lib/internal-auth.server";

/**
 * Unified dashboard metrics for the field-app /account page (and reusable
 * elsewhere). Single source of truth for the revenue + quota + top-companies
 * calculations so the two apps don't drift apart.
 *
 * Scoping rules:
 *   - REP role: results filter to the rep's own orders. Quota progress
 *     returned for the rep + current month.
 *   - MANAGER / ADMIN: shop-wide aggregate. No quota is returned (quotas are
 *     a per-rep concept).
 */

export interface RepDashboardCompany {
  id: string;
  name: string;
  accountNumber: string | null;
  revenueCents: number;
}

export interface RepDashboardMetrics {
  /** Sum of order totals this month, in dollars. */
  revenue: number;
  /** Percent change vs. last month (rounded). */
  revenueChange: number;
  /** Per-rep quota progress for the current month. Null for non-REP roles. */
  quota: QuotaProgress | null;
  /** Top 10 companies by revenue this month (PENDING + PAID). */
  companiesByRevenue: RepDashboardCompany[];
}

export async function getRepDashboardMetrics(
  shopId: string,
  repId: string,
  role: RepRole
): Promise<RepDashboardMetrics> {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0);

  // REPs see only their own orders; admins/managers see shop-wide.
  const repFilter = role === "REP" ? { salesRepId: repId } : {};

  const [thisMonthAgg, lastMonthAgg, companiesAgg] = await Promise.all([
    prisma.order.aggregate({
      where: { shopId, ...repFilter, placedAt: { gte: startOfMonth } },
      _sum: { totalCents: true },
    }),
    prisma.order.aggregate({
      where: {
        shopId,
        ...repFilter,
        placedAt: { gte: startOfLastMonth, lte: endOfLastMonth },
      },
      _sum: { totalCents: true },
    }),
    prisma.order.groupBy({
      by: ["companyId"],
      where: {
        shopId,
        ...repFilter,
        placedAt: { gte: startOfMonth },
        status: { in: ["PENDING", "PAID"] },
      },
      _sum: { totalCents: true },
      orderBy: { _sum: { totalCents: "desc" } },
      take: 10,
    }),
  ]);

  const thisMonthRevenue = (thisMonthAgg._sum?.totalCents || 0) / 100;
  const prevMonthRevenue = (lastMonthAgg._sum?.totalCents || 0) / 100;
  const revenueChange =
    prevMonthRevenue > 0
      ? Math.round(((thisMonthRevenue - prevMonthRevenue) / prevMonthRevenue) * 100)
      : thisMonthRevenue > 0
        ? 100
        : 0;

  const quota = role === "REP" ? await getRepQuotaProgress(shopId, repId) : null;

  // Hydrate the company groupings with names + account numbers.
  let companiesByRevenue: RepDashboardCompany[] = [];
  if (companiesAgg.length > 0) {
    const companies = await prisma.company.findMany({
      where: {
        id: { in: companiesAgg.map((c) => c.companyId) },
        shopId,
      },
      select: { id: true, name: true, accountNumber: true },
    });
    const byId = new Map(companies.map((c) => [c.id, c]));
    companiesByRevenue = companiesAgg
      .map((item) => {
        const company = byId.get(item.companyId);
        if (!company) return null;
        return {
          id: company.id,
          name: company.name,
          accountNumber: company.accountNumber,
          revenueCents: item._sum.totalCents || 0,
        };
      })
      .filter((x): x is RepDashboardCompany => x !== null);
  }

  return {
    revenue: thisMonthRevenue,
    revenueChange,
    quota,
    companiesByRevenue,
  };
}
