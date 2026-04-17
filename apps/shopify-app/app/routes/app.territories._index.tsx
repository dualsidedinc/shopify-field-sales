import type { LoaderFunctionArgs, ActionFunctionArgs, HeadersFunction } from "react-router";
import { useLoaderData, useNavigate, useFetcher } from "react-router";
import { useState, useMemo, useEffect } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { prisma } from "@field-sales/database";
import {
  getTerritories,
  getTerritoryAlignmentReport,
  realignAllLocationsToTerritories,
  type TerritoryListItem,
  type TerritoryAlignmentReport,
} from "../services/territory.server";

interface LoaderData {
  territories: TerritoryListItem[];
  alignmentReport: TerritoryAlignmentReport;
  shopId: string | null;
}

interface ActionData {
  success?: boolean;
  updated?: number;
  total?: number;
  error?: string;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: session.shop },
  });

  if (!shop) {
    return {
      territories: [],
      alignmentReport: {
        summary: {
          totalLocations: 0,
          locationsWithTerritory: 0,
          locationsWithoutTerritory: 0,
          totalCompanies: 0,
          companiesWithTerritoryLocations: 0,
          companiesWithoutTerritoryLocations: 0,
          totalTerritories: 0,
          territoriesWithReps: 0,
          territoriesWithoutReps: 0,
        },
        unassignedLocations: [],
        companiesWithoutTerritories: [],
        territoriesWithoutReps: [],
      },
      shopId: null,
    };
  }

  const [territories, alignmentReport] = await Promise.all([
    getTerritories(shop.id),
    getTerritoryAlignmentReport(shop.id),
  ]);

  return {
    territories,
    alignmentReport,
    shopId: shop.id,
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

  if (actionType === "realign") {
    const result = await realignAllLocationsToTerritories(shop.id);
    return { success: true, ...result };
  }

  return { success: false, error: "Unknown action" };
};

export default function TerritoriesPage() {
  const { territories, alignmentReport, shopId } = useLoaderData<LoaderData>();
  const navigate = useNavigate();
  const fetcher = useFetcher<ActionData>();
  const shopify = useAppBridge();
  const [searchQuery, setSearchQuery] = useState("");

  const isRealigning = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.data?.success && fetcher.data.updated !== undefined) {
      shopify.toast.show(`Realigned ${fetcher.data.updated} of ${fetcher.data.total} locations`);
    }
    if (fetcher.data?.error) {
      shopify.toast.show(fetcher.data.error, { isError: true });
    }
  }, [fetcher.data, shopify]);

  // Filter territories based on search query
  const filteredTerritories = useMemo(() => {
    if (!searchQuery.trim()) return territories;
    const query = searchQuery.toLowerCase();
    return territories.filter(
      (t) =>
        t.name.toLowerCase().includes(query) ||
        t.description?.toLowerCase().includes(query)
    );
  }, [territories, searchQuery]);

  if (!shopId) {
    return (
      <s-page heading="Territories">
        <s-section>
          <s-stack gap="base">
            <s-heading>Setup Required</s-heading>
            <s-paragraph>
              Your store needs to complete setup before managing territories.
            </s-paragraph>
          </s-stack>
        </s-section>
      </s-page>
    );
  }

  const { summary } = alignmentReport;
  const hasAlignmentIssues =
    summary.locationsWithoutTerritory > 0 ||
    summary.territoriesWithoutReps > 0;

  const handleRealign = () => {
    fetcher.submit({ _action: "realign" }, { method: "POST" });
  };

  return (
    <s-page heading="Territories">
      <s-link slot="breadcrumb-actions" href="/app/reps">
        Sales Field
      </s-link>

      <s-link slot="secondary-actions" href="/app/territories/create">
        Add Territory
      </s-link>

      <s-box paddingBlock="base">
        <s-paragraph>
          Territories group companies by geographic region. Each territory can be assigned
          to one or more sales reps. Companies are matched to territories based on state or ZIP code.
        </s-paragraph>
      </s-box>

      {/* Alignment Report Section */}
      <s-section>
        <s-stack gap="base">
          <s-heading>Territory Alignment</s-heading>

          {hasAlignmentIssues ? (
            <s-banner tone="warning">
              There are alignment issues that may affect sales rep access to companies.
            </s-banner>
          ) : (
            <s-banner tone="success">
              All locations are assigned to territories and all territories have reps.
            </s-banner>
          )}

          <s-grid gap="base" gridTemplateColumns="repeat(3, 1fr)">
            <s-box padding="base" background="subdued" borderRadius="base">
              <s-stack gap="small-100">
                <s-text color="subdued">Locations</s-text>
                <s-text>
                  {summary.locationsWithTerritory} / {summary.totalLocations} assigned
                </s-text>
                {summary.locationsWithoutTerritory > 0 && (
                  <s-badge tone="warning">{summary.locationsWithoutTerritory} unassigned</s-badge>
                )}
              </s-stack>
            </s-box>

            <s-box padding="base" background="subdued" borderRadius="base">
              <s-stack gap="small-100">
                <s-text color="subdued">Companies</s-text>
                <s-text>
                  {summary.companiesWithTerritoryLocations} / {summary.totalCompanies} covered
                </s-text>
                {summary.companiesWithoutTerritoryLocations > 0 && (
                  <s-badge tone="warning">{summary.companiesWithoutTerritoryLocations} not covered</s-badge>
                )}
              </s-stack>
            </s-box>

            <s-box padding="base" background="subdued" borderRadius="base">
              <s-stack gap="small-100">
                <s-text color="subdued">Territories</s-text>
                <s-text>
                  {summary.territoriesWithReps} / {summary.totalTerritories} have reps
                </s-text>
                {summary.territoriesWithoutReps > 0 && (
                  <s-badge tone="warning">{summary.territoriesWithoutReps} no reps</s-badge>
                )}
              </s-stack>
            </s-box>
          </s-grid>

          {summary.locationsWithoutTerritory > 0 && (
            <s-button onClick={handleRealign} disabled={isRealigning}>
              {isRealigning ? "Realigning..." : "Realign All Locations"}
            </s-button>
          )}
        </s-stack>
      </s-section>

      <s-section padding="none" accessibilityLabel="Territories list">
        {territories.length === 0 ? (
          <s-box padding="base">
            <s-stack gap="base">
              <s-heading>No territories yet</s-heading>
              <s-paragraph>
                Create your first territory to organize companies by region.
              </s-paragraph>
            </s-stack>
          </s-box>
        ) : (
          <s-table>
            <s-grid slot="filters" gap="small-200" gridTemplateColumns="1fr">
              <s-text-field
                icon="search"
                label="Search territories"
                labelAccessibilityVisibility="exclusive"
                placeholder="Search territories..."
                autocomplete="off"
                value={searchQuery}
                onInput={(e: Event) => {
                  const target = e.target as HTMLInputElement;
                  setSearchQuery(target.value);
                }}
              />
            </s-grid>

            <s-table-header-row>
              <s-table-header>Territory</s-table-header>
              <s-table-header>States</s-table-header>
              <s-table-header>ZIP Codes</s-table-header>
              <s-table-header>Locations</s-table-header>
              <s-table-header>Reps</s-table-header>
              <s-table-header>Status</s-table-header>
            </s-table-header-row>

            <s-table-body>
              {filteredTerritories.length === 0 ? (
                <s-table-row>
                  <s-table-cell>
                    <s-text color="subdued">No territories match your search.</s-text>
                  </s-table-cell>
                  <s-table-cell />
                  <s-table-cell />
                  <s-table-cell />
                  <s-table-cell />
                  <s-table-cell />
                </s-table-row>
              ) : (
                filteredTerritories.map((territory) => (
                  <s-table-row key={territory.id} clickDelegate={`territory-link-${territory.id}`}>
                    <s-table-cell>
                      <s-stack gap="none">
                        <s-link
                          id={`territory-link-${territory.id}`}
                          onClick={() => navigate(`/app/territories/${territory.id}`)}
                        >
                          {territory.name}
                        </s-link>
                        {territory.description && (
                          <s-text color="subdued">{territory.description}</s-text>
                        )}
                      </s-stack>
                    </s-table-cell>
                    <s-table-cell>{territory.stateCount}</s-table-cell>
                    <s-table-cell>{territory.zipcodeCount}</s-table-cell>
                    <s-table-cell>{territory.locationCount}</s-table-cell>
                    <s-table-cell>{territory.repCount}</s-table-cell>
                    <s-table-cell>
                      {territory.isActive ? (
                        <s-badge tone="success">Active</s-badge>
                      ) : (
                        <s-badge tone="warning">Inactive</s-badge>
                      )}
                    </s-table-cell>
                  </s-table-row>
                ))
              )}
            </s-table-body>
          </s-table>
        )}
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
