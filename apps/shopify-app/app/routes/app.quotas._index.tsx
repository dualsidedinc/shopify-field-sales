import type { LoaderFunctionArgs, ActionFunctionArgs, HeadersFunction } from "react-router";
import { useLoaderData, useNavigate, useFetcher, useSearchParams } from "react-router";
import { useState, useEffect, useCallback } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { prisma } from "@field-sales/database";
import { copyQuotasToMonth } from "../services/quota.server";
import { getActiveSalesReps } from "../services/salesRep.server";
import {
  DateRangeSelector,
  getDateRange,
  getMonthFromDateRange,
} from "../components/DateRangeSelector";

interface RepQuotaRow {
  id: string;
  name: string;
  targetCents: number | null;
  achievedCents: number;
  projectedCents: number;
  progressPercent: number | null;
  onPaceIndicator: string;
}

interface LoaderData {
  reps: RepQuotaRow[];
  startDate: string;
  endDate: string;
  year: number;
  month: number;
  shopId: string | null;
  teamTotals: {
    totalTargetCents: number;
    totalAchievedCents: number;
    repsWithQuotas: number;
    totalReps: number;
  };
}

interface ActionData {
  success?: boolean;
  message?: string;
  error?: string;
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

function formatCents(cents: number | null): string {
  if (cents === null) return "-";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function getPaceColor(indicator: string): "success" | "info" | "warning" | "critical" {
  switch (indicator) {
    case "ahead": return "success";
    case "on_pace": return "info";
    case "behind": return "warning";
    case "at_risk": return "critical";
    default: return "info";
  }
}

function getPaceLabel(indicator: string): string {
  switch (indicator) {
    case "ahead": return "Ahead";
    case "on_pace": return "On Pace";
    case "behind": return "Behind";
    case "at_risk": return "At Risk";
    case "no_quota": return "No Quota";
    default: return "-";
  }
}

function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

function getDaysElapsed(year: number, month: number): number {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;

  if (year < currentYear || (year === currentYear && month < currentMonth)) {
    return getDaysInMonth(year, month);
  } else if (year === currentYear && month === currentMonth) {
    return now.getDate();
  } else {
    return 0;
  }
}

function calculateOnPaceIndicator(
  achievedCents: number,
  targetCents: number,
  daysElapsed: number,
  totalDays: number
): string {
  if (targetCents === 0 || daysElapsed === 0) return "on_pace";

  const expectedProgress = (daysElapsed / totalDays) * targetCents;
  const ratio = achievedCents / expectedProgress;

  if (ratio >= 1.1) return "ahead";
  if (ratio >= 0.9) return "on_pace";
  if (ratio >= 0.7) return "behind";
  return "at_risk";
}

// Generate all months between two dates
function getMonthsInRange(startDate: string, endDate: string): Array<{ year: number; month: number }> {
  const start = new Date(startDate + "T00:00:00");
  const end = new Date(endDate + "T00:00:00");
  const months: Array<{ year: number; month: number }> = [];

  let current = new Date(start.getFullYear(), start.getMonth(), 1);
  const endMonth = new Date(end.getFullYear(), end.getMonth(), 1);

  while (current <= endMonth) {
    months.push({ year: current.getFullYear(), month: current.getMonth() + 1 });
    current.setMonth(current.getMonth() + 1);
  }

  return months;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);

  // Get date range from URL or default to "this month"
  const defaultRange = getDateRange("this_month");
  const startDate = url.searchParams.get("startDate") || defaultRange.start;
  const endDate = url.searchParams.get("endDate") || defaultRange.end;

  // Extract year/month from start date (for display purposes)
  const { year, month } = getMonthFromDateRange(startDate);

  // Get all months in the range for quota aggregation
  const monthsInRange = getMonthsInRange(startDate, endDate);

  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: session.shop },
  });

  if (!shop) {
    return {
      reps: [],
      startDate,
      endDate,
      year,
      month,
      shopId: null,
      teamTotals: {
        totalTargetCents: 0,
        totalAchievedCents: 0,
        repsWithQuotas: 0,
        totalReps: 0,
      },
    };
  }

  // Get all active reps
  const activeReps = await getActiveSalesReps(shop.id);

  // Get quotas for all months in the range
  const quotas = await prisma.repQuota.findMany({
    where: {
      shopId: shop.id,
      OR: monthsInRange.map(({ year: y, month: m }) => ({ year: y, month: m })),
    },
  });

  // Aggregate quotas per rep across all months in range
  const quotaMap = new Map<string, number>();
  for (const quota of quotas) {
    const current = quotaMap.get(quota.repId) || 0;
    quotaMap.set(quota.repId, current + quota.targetCents);
  }

  // Get date range for revenue calculation
  const periodStart = new Date(startDate + "T00:00:00");
  const periodEnd = new Date(endDate + "T23:59:59.999");

  // Calculate days for pace indicator (works for any date range)
  const now = new Date();
  const rangeEndDate = new Date(endDate + "T23:59:59.999");
  const totalDays = Math.ceil((rangeEndDate.getTime() - periodStart.getTime()) / (1000 * 60 * 60 * 24)) + 1;
  const effectiveEnd = now < rangeEndDate ? now : rangeEndDate;
  const daysElapsed = Math.ceil((effectiveEnd.getTime() - periodStart.getTime()) / (1000 * 60 * 60 * 24)) + 1;

  // Build rep quota rows
  const reps: RepQuotaRow[] = [];
  let totalTargetCents = 0;
  let totalAchievedCents = 0;
  let repsWithQuotas = 0;

  for (const rep of activeReps) {
    // Get revenue for this rep in the period
    const [paidOrders, pendingOrders] = await Promise.all([
      prisma.order.aggregate({
        where: {
          shopId: shop.id,
          salesRepId: rep.id,
          status: "PAID",
          placedAt: { gte: periodStart, lte: periodEnd },
        },
        _sum: { totalCents: true },
      }),
      prisma.order.aggregate({
        where: {
          shopId: shop.id,
          salesRepId: rep.id,
          status: "PENDING",
          placedAt: { gte: periodStart, lte: periodEnd },
        },
        _sum: { totalCents: true },
      }),
    ]);

    const achievedCents = paidOrders._sum.totalCents || 0;
    const pendingCents = pendingOrders._sum.totalCents || 0;
    const projectedCents = achievedCents + pendingCents;

    const targetCents = quotaMap.get(rep.id) ?? null;

    let progressPercent: number | null = null;
    let onPaceIndicator = "no_quota";

    if (targetCents !== null && targetCents > 0) {
      progressPercent = Math.round((achievedCents / targetCents) * 100);
      onPaceIndicator = calculateOnPaceIndicator(achievedCents, targetCents, daysElapsed, totalDays);
      totalTargetCents += targetCents;
      repsWithQuotas++;
    }

    totalAchievedCents += achievedCents;

    reps.push({
      id: rep.id,
      name: rep.name,
      targetCents,
      achievedCents,
      projectedCents,
      progressPercent,
      onPaceIndicator,
    });
  }

  // Sort: reps with quotas first (by progress), then reps without quotas
  reps.sort((a, b) => {
    if (a.targetCents !== null && b.targetCents === null) return -1;
    if (a.targetCents === null && b.targetCents !== null) return 1;
    if (a.targetCents !== null && b.targetCents !== null) {
      return (b.progressPercent || 0) - (a.progressPercent || 0);
    }
    return a.name.localeCompare(b.name);
  });

  return {
    reps,
    startDate,
    endDate,
    year,
    month,
    shopId: shop.id,
    teamTotals: {
      totalTargetCents,
      totalAchievedCents,
      repsWithQuotas,
      totalReps: activeReps.length,
    },
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: session.shop },
  });

  if (!shop) {
    return { success: false, error: "Shop not found" };
  }

  const formData = await request.formData();
  const actionType = formData.get("_action");

  if (actionType === "copyFromPrevious") {
    const toYear = parseInt(formData.get("toYear") as string);
    const toMonth = parseInt(formData.get("toMonth") as string);

    // Calculate previous month
    let fromYear = toYear;
    let fromMonth = toMonth - 1;
    if (fromMonth < 1) {
      fromMonth = 12;
      fromYear--;
    }

    const result = await copyQuotasToMonth(shop.id, fromYear, fromMonth, toYear, toMonth);

    if (result.success) {
      return { success: true, message: `Copied ${result.count} quotas from ${MONTH_NAMES[fromMonth - 1]}` };
    }
    return { success: false, error: result.error };
  }

  return { success: false, error: "Unknown action" };
};

export default function QuotasPage() {
  const {
    reps,
    startDate,
    endDate,
    year,
    month,
    shopId,
    teamTotals,
  } = useLoaderData<LoaderData>();

  const navigate = useNavigate();
  const fetcher = useFetcher<ActionData>();
  const shopify = useAppBridge();
  const [searchParams, setSearchParams] = useSearchParams();

  useEffect(() => {
    if (fetcher.data?.success && fetcher.data?.message) {
      shopify.toast.show(fetcher.data.message);
    }
    if (fetcher.data?.error) {
      shopify.toast.show(fetcher.data.error, { isError: true });
    }
  }, [fetcher.data, shopify]);

  const handleDateChange = useCallback((start: string, end: string) => {
    setSearchParams({ startDate: start, endDate: end });
  }, [setSearchParams]);

  const handleCopyFromPrevious = () => {
    fetcher.submit(
      { _action: "copyFromPrevious", toYear: String(year), toMonth: String(month) },
      { method: "POST" }
    );
  };

  if (!shopId) {
    return (
      <s-page heading="Quotas">
        <s-section>
          <s-stack gap="base">
            <s-heading>Setup Required</s-heading>
            <s-paragraph>
              Your store needs to complete setup before managing quotas.
            </s-paragraph>
          </s-stack>
        </s-section>
      </s-page>
    );
  }

  const teamProgressPercent = teamTotals.totalTargetCents > 0
    ? Math.round((teamTotals.totalAchievedCents / teamTotals.totalTargetCents) * 100)
    : 0;

  return (
    <s-page heading="Quotas">
      <s-link slot="breadcrumb-actions" href="/app/reps">
        Sales Field
      </s-link>
      <s-link slot="secondary-actions" href="/app/quotas/forecast">
        Forecasts
      </s-link>

      <s-stack gap="base">
        {/* Description */}
        <s-paragraph>
          Track monthly revenue quotas for your sales team. Click on a rep to set or edit their quotas.
        </s-paragraph>

        {/* Date Range Selector */}
        <DateRangeSelector
          startDate={startDate}
          endDate={endDate}
          onDateChange={handleDateChange}
          popoverId="quota-date-popover"
        />

        {/* Team Summary */}
        <s-section>
          <s-grid gap="base" gridTemplateColumns="1fr 1fr 1fr 1fr">
            <s-box padding="base" background="subdued" borderRadius="base">
              <s-stack gap="none">
                <s-text color="subdued">Reps with Quotas</s-text>
                <s-heading>{teamTotals.repsWithQuotas} / {teamTotals.totalReps}</s-heading>
              </s-stack>
            </s-box>
            <s-box padding="base" background="subdued" borderRadius="base">
              <s-stack gap="none">
                <s-text color="subdued">Team Target</s-text>
                <s-heading>{formatCents(teamTotals.totalTargetCents)}</s-heading>
              </s-stack>
            </s-box>
            <s-box padding="base" background="subdued" borderRadius="base">
              <s-stack gap="none">
                <s-text color="subdued">Team Achieved</s-text>
                <s-heading>{formatCents(teamTotals.totalAchievedCents)}</s-heading>
              </s-stack>
            </s-box>
            <s-box padding="base" background="subdued" borderRadius="base">
              <s-stack gap="none">
                <s-text color="subdued">Team Progress</s-text>
                <s-heading>{teamProgressPercent}%</s-heading>
              </s-stack>
            </s-box>
          </s-grid>
        </s-section>

        {/* Quick Actions */}
        {teamTotals.repsWithQuotas === 0 && (
          <s-banner tone="info">
            No quotas set for {MONTH_NAMES[month - 1]} {year}. Click on a rep to set their quota, or copy from last month.
          </s-banner>
        )}

        {/* Rep Quota Table */}
        <s-section>
          {teamTotals.repsWithQuotas < teamTotals.totalReps && teamTotals.repsWithQuotas > 0 && (
            <s-banner tone="warning">
              {teamTotals.totalReps - teamTotals.repsWithQuotas} {teamTotals.totalReps - teamTotals.repsWithQuotas === 1 ? "rep is" : "reps are"} missing quotas for {MONTH_NAMES[month - 1]}.
            </s-banner>
          )}

          {reps.length === 0 ? (
            <s-box padding="large">
              <s-stack gap="base" alignItems="center">
                <s-text color="subdued">No active sales reps found.</s-text>
                <s-button onClick={() => navigate("/app/reps/create")}>
                  Add Sales Rep
                </s-button>
              </s-stack>
            </s-box>
          ) : (
            <s-table>
              <s-table-header-row>
                <s-table-header>Sales Rep</s-table-header>
                <s-table-header>Quota</s-table-header>
                <s-table-header>Achieved</s-table-header>
                <s-table-header>Projected</s-table-header>
                <s-table-header>Progress</s-table-header>
                <s-table-header>Status</s-table-header>
              </s-table-header-row>

              <s-table-body>
                {reps.map((rep) => (
                  <s-table-row key={rep.id} clickDelegate={`rep-link-${rep.id}`}>
                    <s-table-cell>
                      <s-link
                        id={`rep-link-${rep.id}`}
                        onClick={() => navigate(`/app/quotas/${rep.id}`)}
                      >
                        <s-text type="strong">{rep.name}</s-text>
                      </s-link>
                    </s-table-cell>
                    <s-table-cell>
                      {rep.targetCents !== null ? (
                        formatCents(rep.targetCents)
                      ) : (
                        <s-text color="subdued">Not set</s-text>
                      )}
                    </s-table-cell>
                    <s-table-cell>{formatCents(rep.achievedCents)}</s-table-cell>
                    <s-table-cell>
                      <s-text color="subdued">{formatCents(rep.projectedCents)}</s-text>
                    </s-table-cell>
                    <s-table-cell>
                      {rep.progressPercent !== null ? `${rep.progressPercent}%` : "-"}
                    </s-table-cell>
                    <s-table-cell>
                      <s-badge tone={getPaceColor(rep.onPaceIndicator)}>
                        {getPaceLabel(rep.onPaceIndicator)}
                      </s-badge>
                    </s-table-cell>
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>
          )}
        </s-section>
      </s-stack>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
