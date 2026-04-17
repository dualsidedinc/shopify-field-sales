import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useLoaderData, useNavigate, useSearchParams, useFetcher } from "react-router";
import { useEffect, useRef } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";
import { getAuthenticatedShop } from "../services/shop.server";
import {
  getLeads,
  getLeadCounts,
  getLeadFormFields,
  deleteLead,
  type Lead,
  type LeadFormField,
  type LeadStatus,
} from "../services/lead.server";
import { LeadStatusBadge } from "../components/LeadStatusBadge";

interface LoaderData {
  leads: Lead[];
  total: number;
  counts: Record<LeadStatus | "all", number>;
  formFields: LeadFormField[];
  currentStatus: LeadStatus | "all";
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop } = await getAuthenticatedShop(request);
  const url = new URL(request.url);
  const statusParam = url.searchParams.get("status") || "all";

  const status = ["NEW", "REVIEWED", "APPROVED", "REJECTED", "all"].includes(statusParam)
    ? (statusParam as LeadStatus | "all")
    : "all";

  const [leadsResult, counts, formFields] = await Promise.all([
    getLeads(shop.id, { status }),
    getLeadCounts(shop.id),
    getLeadFormFields(shop.id),
  ]);

  return {
    leads: leadsResult.leads,
    total: leadsResult.total,
    counts,
    formFields,
    currentStatus: status,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop } = await getAuthenticatedShop(request);
  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  try {
    if (intent === "deleteLead") {
      const leadId = formData.get("leadId") as string;
      await deleteLead(shop.id, leadId);
      return { success: true, message: "Lead deleted" };
    }

    return { success: false, error: "Unknown action" };
  } catch (error) {
    console.error("Leads action error:", error);
    return { success: false, error: "An error occurred" };
  }
};

function formatDate(date: Date | string): string {
  return new Date(date).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getFieldValue(lead: Lead, fieldName: string): string {
  const formData = lead.formData as Record<string, unknown>;
  const value = formData[fieldName];
  if (value === undefined || value === null) return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value) || "—";
}

export default function LeadsListPage() {
  const { leads, counts, formFields, currentStatus } = useLoaderData<LoaderData>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const shopify = useAppBridge();
  const fetcher = useFetcher();

  // Track processed fetcher results
  const lastProcessedData = useRef<unknown>(null);

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data && fetcher.data !== lastProcessedData.current) {
      lastProcessedData.current = fetcher.data;
      if (fetcher.data.success && fetcher.data.message) {
        shopify.toast.show(fetcher.data.message);
      }
      if (fetcher.data.error) {
        shopify.toast.show(fetcher.data.error, { isError: true });
      }
    }
  }, [fetcher.state, fetcher.data, shopify]);

  const handleStatusFilter = (status: string) => {
    if (status === "all") {
      searchParams.delete("status");
    } else {
      searchParams.set("status", status);
    }
    setSearchParams(searchParams);
  };

  const handleDeleteLead = (leadId: string) => {
    if (confirm("Are you sure you want to delete this lead?")) {
      fetcher.submit(
        { intent: "deleteLead", leadId },
        { method: "post" }
      );
    }
  };

  // Find key fields to display in the table
  const displayFields = formFields
    .filter((f) => f.isActive && ["company_name", "contact_name", "email"].includes(f.name))
    .sort((a, b) => a.position - b.position);

  // If key fields don't exist, show first 3 active fields
  const columnsToShow = displayFields.length > 0
    ? displayFields
    : formFields.filter((f) => f.isActive).slice(0, 3);

  const statusTabs: { value: LeadStatus | "all"; label: string; count: number }[] = [
    { value: "all", label: "All", count: counts.all },
    { value: "NEW", label: "New", count: counts.NEW },
    { value: "REVIEWED", label: "Reviewed", count: counts.REVIEWED },
    { value: "APPROVED", label: "Approved", count: counts.APPROVED },
    { value: "REJECTED", label: "Rejected", count: counts.REJECTED },
  ];

  return (
    <s-page heading="Leads">
      <s-link slot="breadcrumb-actions" href="/app/companies">
        Companies
      </s-link>
      <s-link href="/app/leads/form-builder" slot="secondary-actions">
        Form Builder
      </s-link>

      {/* Status Filter Tabs */}
      <s-section>
        <s-stack direction="inline" gap="small-200">
          {statusTabs.map((tab) => (
            <s-button
              key={tab.value}
              variant={currentStatus === tab.value ? "primary" : "secondary"}
              onClick={() => handleStatusFilter(tab.value)}
            >
              {tab.label} ({tab.count})
            </s-button>
          ))}
        </s-stack>
      </s-section>

      {/* Leads Table */}
      <s-section>
        {leads.length > 0 ? (
          <s-table>
            <s-table-header-row>
              {columnsToShow.map((field) => (
                <s-table-header key={field.id}>{field.label}</s-table-header>
              ))}
              <s-table-header>Status</s-table-header>
              <s-table-header>Submitted</s-table-header>
              <s-table-header></s-table-header>
            </s-table-header-row>
            <s-table-body>
              {leads.map((lead) => (
                <s-table-row key={lead.id}>
                  {columnsToShow.map((field) => (
                    <s-table-cell key={field.id}>
                      {field.name === "company_name" || field.name === "email" ? (
                        <s-link
                          href={`/app/leads/${lead.id}`}
                          onClick={(e: Event) => {
                            e.preventDefault();
                            navigate(`/app/leads/${lead.id}`);
                          }}
                        >
                          {getFieldValue(lead, field.name)}
                        </s-link>
                      ) : (
                        <s-text>{getFieldValue(lead, field.name)}</s-text>
                      )}
                    </s-table-cell>
                  ))}
                  <s-table-cell>
                    <LeadStatusBadge status={lead.status} />
                  </s-table-cell>
                  <s-table-cell>
                    <s-text color="subdued">{formatDate(lead.submittedAt)}</s-text>
                  </s-table-cell>
                  <s-table-cell>
                    <s-stack direction="inline" gap="small-200">
                      <s-button
                        variant="tertiary"
                        icon="view"
                        accessibilityLabel="View"
                        onClick={() => navigate(`/app/leads/${lead.id}`)}
                      />
                      <s-button
                        variant="tertiary"
                        icon="delete"
                        accessibilityLabel="Delete"
                        onClick={() => handleDeleteLead(lead.id)}
                      />
                    </s-stack>
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        ) : (
          <s-box padding="large">
            <s-stack gap="base" alignItems="center">
              <s-text color="subdued">
                {currentStatus === "all"
                  ? "No leads yet. Share your lead form URL to start collecting submissions."
                  : `No ${currentStatus.toLowerCase()} leads.`}
              </s-text>
              {currentStatus === "all" && (
                <s-button variant="secondary" href="/app/leads/form-builder">
                  Configure Form
                </s-button>
              )}
            </s-stack>
          </s-box>
        )}
      </s-section>
    </s-page>
  );
}
