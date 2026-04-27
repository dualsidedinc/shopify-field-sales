import type { LoaderFunctionArgs, HeadersFunction } from "react-router";
import { useLoaderData, useSearchParams } from "react-router";
import { useCallback, useEffect } from "react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { getDashboardData, type DashboardData } from "../services/shop.server";
import { DateRangeSelector, getDateRange } from "../components/DateRangeSelector";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  return getDashboardData(request);
};

function formatCurrency(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function MetricCard({
  label,
  value,
  changePercent,
  isCurrency = false,
}: {
  label: string;
  value: number;
  changePercent: number;
  isCurrency?: boolean;
}) {
  const isPositive = changePercent >= 0;
  const displayValue = isCurrency ? formatCurrency(value) : value.toLocaleString();
  const arrow = isPositive ? "↑" : "↓";
  const showChange = changePercent !== 0;

  return (
    <s-box padding="base">
      <s-stack gap="small-300">
        <s-heading>{label}</s-heading>
        <s-stack direction="inline" gap="small">
          <s-heading><span style={{ fontSize: "15px" }}>{displayValue}</span></s-heading>
          {showChange && (
            <s-badge tone={isPositive ? "success" : "critical"}>
              {arrow} {Math.abs(changePercent)}%
            </s-badge>
          )}
        </s-stack>
      </s-stack>
    </s-box>
  );
}

function ActionCard({
  icon,
  label,
  value,
  url,
}: {
  icon: string;
  label: string;
  value: string | number;
  url?: string;
}) {
  const content = (
    <s-stack direction="inline" gap="small-200">
      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
      <s-icon type={icon as any} />
      <s-text>{value} {label}</s-text>
    </s-stack>
  );

  if (url) {
    return (
      <s-clickable href={url} padding="small" background="base" borderRadius="base">
        {content}
      </s-clickable>
    );
  }

  return (
    <s-box padding="small" background="base" borderRadius="base">
      {content}
    </s-box>
  );
}

function Leaderboard({
  title,
  items,
  emptyMessage,
}: {
  title: string;
  items: { id: string; name: string; revenueCents: number; orderCount: number }[];
  emptyMessage: string;
}) {
  return (
    <s-box borderWidth="base" borderRadius="base" background="base">
      <s-box padding="base" borderWidth="none none base none">
        <s-text type="strong">{title}</s-text>
      </s-box>
      {items.length === 0 ? (
        <s-box padding="base">
          <s-text color="subdued">{emptyMessage}</s-text>
        </s-box>
      ) : (
        <s-table>
          <s-table-header-row>
            <s-table-header>#</s-table-header>
            <s-table-header>Name</s-table-header>
            <s-table-header>Orders</s-table-header>
            <s-table-header>Revenue</s-table-header>
          </s-table-header-row>
          <s-table-body>
            {items.map((item, index) => (
              <s-table-row key={item.id}>
                <s-table-cell>{index + 1}</s-table-cell>
                <s-table-cell>{item.name}</s-table-cell>
                <s-table-cell>{item.orderCount}</s-table-cell>
                <s-table-cell>{formatCurrency(item.revenueCents)}</s-table-cell>
              </s-table-row>
            ))}
          </s-table-body>
        </s-table>
      )}
    </s-box>
  );
}

export default function Index() {
  const { shopName, metrics, topSalesReps, topCompanies } = useLoaderData<DashboardData>();
  const [searchParams, setSearchParams] = useSearchParams();

  // Get date range from URL params or use default (This Month)
  const defaultRange = getDateRange("this_month");
  const startDate = searchParams.get("startDate") || defaultRange.start;
  const endDate = searchParams.get("endDate") || defaultRange.end;

  // Set initial params if not present
  useEffect(() => {
    if (!searchParams.has("startDate") || !searchParams.has("endDate")) {
      setSearchParams({ startDate: defaultRange.start, endDate: defaultRange.end }, { replace: true });
    }
  }, []);

  const handleDateChange = useCallback((start: string, end: string) => {
    setSearchParams({ startDate: start, endDate: end });
  }, [setSearchParams]);

  return (
    <s-page heading="Dashboard">
      <s-link href="/app/orders" slot="secondary-actions">Orders</s-link>
      <s-link href="/app/reps" slot="secondary-actions">Sales Field</s-link>

      <s-stack gap="base">
        {/* Period Selector */}
        <DateRangeSelector
          startDate={startDate}
          endDate={endDate}
          onDateChange={handleDateChange}
        />

        {/* Main Metrics Row */}
        <s-box borderWidth="base" borderRadius="base" background="base">
          <s-grid gridTemplateColumns="1fr 1fr 1fr 1fr">
            <MetricCard
              label="Accounts"
              value={metrics.accounts.value}
              changePercent={metrics.accounts.changePercent}
            />
            <MetricCard
              label="Orders"
              value={metrics.orders.value}
              changePercent={metrics.orders.changePercent}
            />
            <MetricCard
              label="Revenue"
              value={metrics.revenue.value}
              changePercent={metrics.revenue.changePercent}
              isCurrency
            />
            <MetricCard
              label="Revenue per Rep"
              value={metrics.revenuePerRep.value}
              changePercent={metrics.revenuePerRep.changePercent}
              isCurrency
            />
          </s-grid>
        </s-box>

        {/* Action Items Row */}
        <s-stack direction="inline" gap="base">
          <ActionCard
            icon="order-draft"
            label="pending orders"
            value={metrics.pendingOrders}
          />
          <ActionCard
            icon="money"
            label="pending revenue"
            value={formatCurrency(metrics.pendingRevenue)}
          />
        </s-stack>

        {/* Leaderboards */}
        <s-grid gridTemplateColumns="1fr 1fr" gap="base">
          <Leaderboard
            title="Top 10 Sales Reps by Revenue"
            items={topSalesReps}
            emptyMessage="No sales data for this period"
          />
          <Leaderboard
            title="Top 10 Companies by Revenue"
            items={topCompanies}
            emptyMessage="No sales data for this period"
          />
        </s-grid>

      </s-stack>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
