import type { LoaderFunctionArgs, ActionFunctionArgs, HeadersFunction } from "react-router";
import { useLoaderData, useNavigate, useFetcher, Form, useRevalidator } from "react-router";
import { useState, useEffect, useCallback } from "react";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { prisma } from "@field-sales/database";
import {
  getSalesRepById,
  updateSalesRep,
  deactivateSalesRep,
  activateSalesRep,
  type SalesRepDetail,
} from "../services/salesRep.server";
import { getActiveTerritories } from "../services/territory.server";
import {
  getRepQuotaProgress,
  getRepQuotaHistory,
  getRepForecast,
  type QuotaHistoryItem,
  type RepForecast,
} from "../services/quota.server";
import type { QuotaProgress } from "@field-sales/shared";
import { SalesRepForm, type SalesRepFormData } from "../components/SalesRepForm";
import { toast } from "../utils/shopify-ui";

interface Territory {
  id: string;
  name: string;
}

interface LoaderData {
  rep: SalesRepDetail | null;
  allTerritories: Territory[];
  shopId: string | null;
  quotaProgress: QuotaProgress | null;
  quotaHistory: QuotaHistoryItem[];
  forecast: RepForecast | null;
  currentYear: number;
  currentMonth: number;
}

interface ActionData {
  success?: boolean;
  error?: string;
  deleted?: boolean;
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

function formatCents(cents: number): string {
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
    default: return "";
  }
}

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const repId = params.id;

  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: session.shop },
  });

  if (!shop || !repId) {
    return {
      rep: null,
      allTerritories: [],
      shopId: null,
      quotaProgress: null,
      quotaHistory: [],
      forecast: null,
      currentYear: new Date().getFullYear(),
      currentMonth: new Date().getMonth() + 1,
    };
  }

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;

  const [rep, allTerritories, quotaProgress, quotaHistory, forecast] = await Promise.all([
    getSalesRepById(shop.id, repId),
    getActiveTerritories(shop.id),
    getRepQuotaProgress(shop.id, repId, currentYear, currentMonth),
    getRepQuotaHistory(shop.id, repId, 6),
    getRepForecast(shop.id, repId, currentYear, currentMonth),
  ]);

  return {
    rep,
    allTerritories,
    shopId: shop.id,
    quotaProgress,
    quotaHistory,
    forecast,
    currentYear,
    currentMonth,
  };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const repId = params.id;

  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: session.shop },
  });

  if (!shop || !repId) {
    return { error: "Invalid request" };
  }

  const contentType = request.headers.get("content-type");

  // Handle JSON submissions (from SaveBar form)
  if (contentType?.includes("application/json")) {
    const data = await request.json();

    // Convert form values to approvalThresholdCents
    // If approval not required, set to null (trusted rep)
    // Otherwise, convert dollars to cents
    const approvalThresholdCents = data.requiresOrderApproval
      ? Math.round(parseFloat(data.approvalThresholdDollars || "0") * 100)
      : null;

    const result = await updateSalesRep(shop.id, repId, {
      firstName: data.firstName,
      lastName: data.lastName,
      email: data.email,
      phone: data.phone || null,
      externalId: data.externalId || null,
      role: data.role || "REP",
      territoryIds: data.territoryIds || [],
      approvalThresholdCents,
    });

    if (result.success) return { success: true };
    return { error: result.error };
  }

  // Handle form submissions (delete/activate actions)
  const formData = await request.formData();
  const actionType = formData.get("_action") as string;

  if (actionType === "delete") {
    const result = await deactivateSalesRep(shop.id, repId);
    if (result.success) return { deleted: true };
    return { error: result.error };
  }

  if (actionType === "activate") {
    const result = await activateSalesRep(shop.id, repId);
    if (result.success) return { success: true };
    return { error: result.error };
  }

  return { error: "Unknown action" };
};

function getTrendColor(trend: string): "success" | "info" | "critical" {
  switch (trend) {
    case "improving": return "success";
    case "stable": return "info";
    case "declining": return "critical";
    default: return "info";
  }
}

function getTrendLabel(trend: string): string {
  switch (trend) {
    case "improving": return "Improving";
    case "stable": return "Stable";
    case "declining": return "Declining";
    default: return "";
  }
}

export default function SalesRepDetailPage() {
  const { rep, allTerritories, shopId, quotaProgress, quotaHistory, forecast, currentYear, currentMonth } = useLoaderData<LoaderData>();
  const navigate = useNavigate();
  const fetcher = useFetcher<ActionData>();
  const revalidator = useRevalidator();
  const [isEditing, setIsEditing] = useState(false);
  const [formKey, setFormKey] = useState(0);

  const actionData = fetcher.data;

  useEffect(() => {
    if (actionData?.deleted) {
      navigate("/app/reps");
    }
  }, [actionData, navigate]);

  useEffect(() => {
    if (actionData?.success) {
      setIsEditing(false);
      setFormKey(k => k + 1); // Force form to remount with fresh data
      revalidator.revalidate(); // Reload data from server
      toast.success("Sales rep updated successfully");
    } else if (actionData?.error) {
      toast.error(actionData.error);
    }
  }, [actionData, revalidator]);

  const handleSubmit = useCallback((data: SalesRepFormData) => {
    fetcher.submit(JSON.stringify(data), {
      method: "POST",
      encType: "application/json",
    });
  }, [fetcher]);

  if (!shopId || !rep) {
    return (
      <s-page heading="Sales Rep Not Found">
        <s-section>
          <s-stack gap="base">
            <s-paragraph>This sales rep was not found or you don't have access.</s-paragraph>
            <s-button onClick={() => navigate("/app/reps")}>Back to Sales Reps</s-button>
          </s-stack>
        </s-section>
      </s-page>
    );
  }

  return (
    <s-page heading={`${rep.firstName} ${rep.lastName}`}>
      <s-link slot="breadcrumb-actions" href="/app/reps">
        Sales Reps
      </s-link>

      {!rep.isActive && (
        <s-section>
          <s-banner tone="warning">
            This sales rep is inactive and cannot access the mobile app.
          </s-banner>
        </s-section>
      )}

      <s-section heading="Sales Rep Details">
        <s-box padding="base" background="subdued" borderRadius="base">
          <SalesRepForm
            key={formKey}
            rep={rep}
            territories={allTerritories}
            onSubmit={handleSubmit}
            onCancel={() => setIsEditing(false)}
          />
        </s-box>
      </s-section>

      {/* Quota Performance Section */}
      <s-section>
        <s-stack gap="base">
          <s-grid gap="base" gridTemplateColumns="1fr auto">
            <s-heading>Quota Performance</s-heading>
            <s-button
              variant="tertiary"
              href={`/app/quotas/${rep.id}`}
            >
              Edit Quota
            </s-button>
          </s-grid>

          {/* Current Month Progress */}
          <s-box padding="base" background="subdued" borderRadius="base">
            <s-stack gap="base">
              <s-grid gap="base" gridTemplateColumns="1fr auto">
                <s-text type="strong">{MONTH_NAMES[currentMonth - 1]} {currentYear}</s-text>
                {quotaProgress && quotaProgress.hasQuota && (
                  <s-badge tone={getPaceColor(quotaProgress.onPaceIndicator)}>
                    {getPaceLabel(quotaProgress.onPaceIndicator)}
                  </s-badge>
                )}
              </s-grid>

              {quotaProgress?.hasQuota ? (
                <s-grid gap="base" gridTemplateColumns="1fr 1fr 1fr 1fr">
                  <s-stack gap="none">
                    <s-text color="subdued">Target</s-text>
                    <s-text type="strong">{formatCents(quotaProgress.targetCents!)}</s-text>
                  </s-stack>
                  <s-stack gap="none">
                    <s-text color="subdued">Achieved</s-text>
                    <s-text type="strong">{formatCents(quotaProgress.achievedCents)}</s-text>
                  </s-stack>
                  <s-stack gap="none">
                    <s-text color="subdued">Projected</s-text>
                    <s-text>{formatCents(quotaProgress.projectedCents)}</s-text>
                  </s-stack>
                  <s-stack gap="none">
                    <s-text color="subdued">Progress</s-text>
                    <s-text type="strong">{quotaProgress.progressPercent}%</s-text>
                  </s-stack>
                </s-grid>
              ) : (
                <s-text color="subdued">No quota set for this month</s-text>
              )}
            </s-stack>
          </s-box>

          {/* Forecasting Section */}
          {forecast && quotaProgress?.hasQuota && (
            <s-box padding="base" background="subdued" borderRadius="base">
              <s-stack gap="base">
                <s-text type="strong">Forecast & Trends</s-text>
                <s-grid gap="base" gridTemplateColumns="1fr 1fr 1fr">
                  {/* Run Rate */}
                  {forecast.runRate && (
                    <s-stack gap="none">
                      <s-text color="subdued">Run Rate Projection</s-text>
                      <s-text type="strong">{formatCents(forecast.runRate.projectedEndOfMonthCents)}</s-text>
                      <s-badge tone={forecast.runRate.onTrackPercent >= 100 ? "success" : "warning"}>
                        {forecast.runRate.onTrackPercent}% of target
                      </s-badge>
                    </s-stack>
                  )}

                  {/* YoY Comparison */}
                  <s-stack gap="none">
                    <s-text color="subdued">vs Last Year</s-text>
                    {forecast.yoy.achievementGrowthPercent !== null ? (
                      <>
                        <s-badge tone={forecast.yoy.achievementGrowthPercent >= 0 ? "success" : "critical"}>
                          {forecast.yoy.achievementGrowthPercent > 0 ? "+" : ""}{forecast.yoy.achievementGrowthPercent}%
                        </s-badge>
                        <s-text color="subdued">
                          LY: {formatCents(forecast.yoy.lastYearAchievedCents)}
                        </s-text>
                      </>
                    ) : (
                      <s-text color="subdued">No data</s-text>
                    )}
                  </s-stack>

                  {/* Trend */}
                  <s-stack gap="none">
                    <s-text color="subdued">Trend ({forecast.trend.monthsAnalyzed} mo)</s-text>
                    <s-badge tone={getTrendColor(forecast.trend.trend)}>
                      {getTrendLabel(forecast.trend.trend)}
                    </s-badge>
                    <s-text color="subdued">
                      Avg: {forecast.trend.averageAttainmentPercent}% attainment
                    </s-text>
                  </s-stack>
                </s-grid>
              </s-stack>
            </s-box>
          )}

          {/* Historical Performance */}
          {quotaHistory.length > 0 && (
            <>
              <s-heading>History</s-heading>
              <s-table>
                <s-table-header-row>
                  <s-table-header>Month</s-table-header>
                  <s-table-header>Target</s-table-header>
                  <s-table-header>Achieved</s-table-header>
                  <s-table-header>Attainment</s-table-header>
                </s-table-header-row>
                <s-table-body>
                  {quotaHistory.map((item) => (
                    <s-table-row key={`${item.year}-${item.month}`}>
                      <s-table-cell>{MONTH_NAMES[item.month - 1]} {item.year}</s-table-cell>
                      <s-table-cell>{formatCents(item.targetCents)}</s-table-cell>
                      <s-table-cell>{formatCents(item.achievedCents)}</s-table-cell>
                      <s-table-cell>
                        <s-badge tone={item.progressPercent >= 100 ? "success" : item.progressPercent >= 80 ? "info" : "warning"}>
                          {item.progressPercent}%
                        </s-badge>
                      </s-table-cell>
                    </s-table-row>
                  ))}
                </s-table-body>
              </s-table>
            </>
          )}

          {quotaHistory.length === 0 && !quotaProgress?.hasQuota && (
            <s-text color="subdued">No quota history available.</s-text>
          )}
        </s-stack>
      </s-section>

      <s-section>
        <s-stack gap="base">
          <s-heading>Companies via Territories ({rep.territoryCompanies.length})</s-heading>
          <s-paragraph>Companies this rep can access through their territory assignments.</s-paragraph>

          {rep.territoryCompanies.length === 0 ? (
            <s-box padding="base" background="subdued" borderRadius="base">
              <s-paragraph>No companies in assigned territories.</s-paragraph>
            </s-box>
          ) : (
            <s-table>
              <s-table-header>
                <s-table-row>
                  <s-table-cell>Company</s-table-cell>
                  <s-table-cell>Account #</s-table-cell>
                  <s-table-cell>Territories</s-table-cell>
                </s-table-row>
              </s-table-header>
              <s-table-body>
                {rep.territoryCompanies.map((company) => (
                  <s-table-row key={company.id}>
                    <s-table-cell>
                      <s-button
                        variant="tertiary"
                        onClick={() => navigate(`/app/companies/${company.id}`)}
                      >
                        {company.name}
                      </s-button>
                    </s-table-cell>
                    <s-table-cell>
                      <s-text color="subdued">{company.accountNumber || "—"}</s-text>
                    </s-table-cell>
                    <s-table-cell>
                      {company.territories.map((t, i) => (
                        <s-badge key={i} tone="info">{t}</s-badge>
                      ))}
                    </s-table-cell>
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>
          )}
        </s-stack>
      </s-section>

      <s-section>
        <s-stack gap="base">
          <s-heading>Directly Assigned ({rep.companies.length})</s-heading>
          <s-paragraph>Companies explicitly assigned to this rep (overrides territory assignment).</s-paragraph>

          {rep.companies.length === 0 ? (
            <s-box padding="base" background="subdued" borderRadius="base">
              <s-paragraph>No companies directly assigned.</s-paragraph>
            </s-box>
          ) : (
            <s-table>
              <s-table-header>
                <s-table-row>
                  <s-table-cell>Company</s-table-cell>
                  <s-table-cell>Territory</s-table-cell>
                </s-table-row>
              </s-table-header>
              <s-table-body>
                {rep.companies.map((company) => (
                  <s-table-row key={company.id}>
                    <s-table-cell>
                      <s-button
                        variant="tertiary"
                        onClick={() => navigate(`/app/companies/${company.id}`)}
                      >
                        {company.name}
                      </s-button>
                    </s-table-cell>
                    <s-table-cell>
                      <s-text color="subdued">{company.territoryName || "Unassigned"}</s-text>
                    </s-table-cell>
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>
          )}
        </s-stack>
      </s-section>

      <s-box padding="small-500">
        {rep.isActive ? (
          <Form method="post">
            <input type="hidden" name="_action" value="delete" />
            <s-button variant="tertiary" tone="critical" type="submit" icon="delete">
              Deactivate Sales Rep
            </s-button>
          </Form>
        ) : (
          <Form method="post">
            <input type="hidden" name="_action" value="activate" />
            <s-button type="submit">Reactivate Sales Rep</s-button>
          </Form>
        )}
      </s-box>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
