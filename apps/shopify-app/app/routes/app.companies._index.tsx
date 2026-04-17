import type { LoaderFunctionArgs, ActionFunctionArgs, HeadersFunction } from "react-router";
import { useLoaderData, useNavigate, useFetcher, useSearchParams } from "react-router";
import { useEffect, useCallback } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { getAuthenticatedShop } from "../services/shop.server";
import { getCompanies, importCompaniesFromShopify, type CompanyListItem } from "../services/company.server";

interface LoaderData {
  companies: CompanyListItem[];
  shopId: string | null;
  hasManagedCompanies: boolean;
  totalCount: number;
  filters: {
    search: string;
    type: string;
  };
}

interface ActionData {
  success?: boolean;
  imported?: number;
  updated?: number;
  error?: string;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const search = url.searchParams.get("search") || "";
  const type = (url.searchParams.get("type") || "all") as "all" | "shopify" | "internal";

  try {
    const { shop } = await getAuthenticatedShop(request);
    const { companies, totalCount } = await getCompanies(shop.id, { search, type });

    return {
      companies,
      shopId: shop.id,
      hasManagedCompanies: shop.hasManagedCompanies,
      totalCount,
      filters: { search, type },
    };
  } catch {
    return {
      companies: [],
      shopId: null,
      hasManagedCompanies: false,
      totalCount: 0,
      filters: { search, type },
    };
  }
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);

  try {
    const { shop } = await getAuthenticatedShop(request);
    const formData = await request.formData();
    const actionType = formData.get("_action");

    if (actionType === "import") {
      const result = await importCompaniesFromShopify(shop.id, admin);
      return result;
    }

    return { success: false, error: "Unknown action" };
  } catch {
    return { success: false, error: "Shop not found" };
  }
};

export default function CompaniesPage() {
  const { companies, shopId, hasManagedCompanies, totalCount, filters } = useLoaderData<LoaderData>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const fetcher = useFetcher<ActionData>();
  const shopify = useAppBridge();

  const isImporting = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.data?.success) {
      const { imported = 0, updated = 0 } = fetcher.data;
      shopify.toast.show(`Imported ${imported} new companies, updated ${updated} existing`);
    }
    if (fetcher.data?.error) {
      shopify.toast.show(fetcher.data.error, { isError: true });
    }
  }, [fetcher.data, shopify]);

  const handleSearchChange = useCallback((e: Event) => {
    const value = (e.target as HTMLInputElement).value;
    const params = new URLSearchParams(searchParams);
    if (value) {
      params.set("search", value);
    } else {
      params.delete("search");
    }
    setSearchParams(params);
  }, [searchParams, setSearchParams]);

  const handleTypeChange = useCallback((e: Event) => {
    const value = (e.target as HTMLSelectElement).value;
    const params = new URLSearchParams(searchParams);
    if (value && value !== "all") {
      params.set("type", value);
    } else {
      params.delete("type");
    }
    setSearchParams(params);
  }, [searchParams, setSearchParams]);

  const handleClearFilters = useCallback(() => {
    setSearchParams({});
  }, [setSearchParams]);

  if (!shopId) {
    return (
      <s-page heading="Companies">
        <s-section>
          <s-stack gap="base">
            <s-heading>Setup Required</s-heading>
            <s-paragraph>
              Your store needs to complete setup before managing companies.
            </s-paragraph>
          </s-stack>
        </s-section>
      </s-page>
    );
  }

  const handleImport = () => {
    fetcher.submit({ _action: "import" }, { method: "POST" });
  };

  const hasActiveFilters = filters.search || filters.type !== "all";

  return (
    <s-page heading="Companies">
      <s-button slot="secondary-actions" href="/app/leads">
        Leads
      </s-button>

      <s-link slot="secondary-actions" href={hasManagedCompanies ? "shopify://admin/companies/new" : "/app/companies/create"}>
        Add Company
      </s-link>

      <s-stack gap="base">
        <s-paragraph>
          <s-text>View your <s-link href="shopify://admin/companies">Shopify Companies</s-link> and manage territory and sales rep alignments. Companies are managed through Shopify.</s-text>
        </s-paragraph>

        <s-section>
          <s-table>
            {/* Filters slot */}
            <s-grid slot="filters" gridTemplateColumns="1fr auto auto" gap="small" alignItems="end">
              <s-search-field
                label="Search companies"
                labelAccessibilityVisibility="exclusive"
                placeholder="Search by name or account #"
                value={filters.search}
                onInput={handleSearchChange}
              />
              <s-select
                label=""
                value={filters.type || "all"}
                onChange={handleTypeChange}
              >
                <s-option value="all">All types</s-option>
                <s-option value="shopify">Shopify managed</s-option>
                <s-option value="internal">Internal</s-option>
              </s-select>
              {hasActiveFilters && (
                <s-button variant="tertiary" onClick={handleClearFilters}>
                  Clear filters
                </s-button>
              )}
            </s-grid>

            {companies.length === 0 ? (
              <s-box padding="large">
                <s-stack gap="base">
                  <s-text color="subdued">
                    {hasActiveFilters
                      ? "No companies match your filters"
                      : hasManagedCompanies
                        ? "Companies will appear here once synced from Shopify."
                        : "Create your first company to start managing B2B customers."}
                  </s-text>
                  {hasActiveFilters && (
                    <s-button variant="tertiary" onClick={handleClearFilters}>
                      Clear filters
                    </s-button>
                  )}
                </s-stack>
              </s-box>
            ) : (
              <>
                <s-table-header-row>
                  <s-table-header>Company</s-table-header>
                  <s-table-header>Account #</s-table-header>
                  <s-table-header>Territory</s-table-header>
                  <s-table-header>Locations</s-table-header>
                  <s-table-header>Contacts</s-table-header>
                  <s-table-header>Type</s-table-header>
                </s-table-header-row>
                <s-table-body>
                  {companies.map((company) => (
                    <s-table-row key={company.id}>
                      <s-table-cell>
                        <s-link href={`/app/companies/${company.id}`}>
                          <s-text type="strong">{company.name}</s-text>
                        </s-link>
                      </s-table-cell>
                      <s-table-cell>
                        <s-text color="subdued">{company.accountNumber || "—"}</s-text>
                      </s-table-cell>
                      <s-table-cell>
                        {company.territoryNames.length > 0 ? (
                          <span style={{ display: "flex", gap: "4px", flexWrap: "wrap" }}>
                            {company.territoryNames.map((name) => (
                              <s-badge key={name}>{name}</s-badge>
                            ))}
                          </span>
                        ) : company.hasManualRepAssignment ? (
                          <s-text color="subdued">Manually Assigned</s-text>
                        ) : (
                          <s-text color="subdued">Unassigned</s-text>
                        )}
                      </s-table-cell>
                      <s-table-cell>{company.locationCount}</s-table-cell>
                      <s-table-cell>{company.contactCount}</s-table-cell>
                      <s-table-cell>
                        {company.isShopifyManaged ? (
                          <s-badge tone="info">Shopify</s-badge>
                        ) : (
                          <s-badge>Internal</s-badge>
                        )}
                      </s-table-cell>
                    </s-table-row>
                  ))}
                </s-table-body>
              </>
            )}
          </s-table>

          {/* Results count */}
          {companies.length > 0 && (
            <s-box padding="small">
              <s-text color="subdued">
                Showing {companies.length} of {totalCount} companies
              </s-text>
            </s-box>
          )}
        </s-section>
      </s-stack>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
