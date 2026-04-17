import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useLoaderData, useNavigate, useFetcher, redirect } from "react-router";
import { useState, useEffect, useRef } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";
import { getAuthenticatedShop } from "../services/shop.server";
import {
  getLeadById,
  updateLeadStatus,
  deleteLead,
  type LeadWithFields,
  type LeadStatus,
} from "../services/lead.server";
import { LeadStatusBadge } from "../components/LeadStatusBadge";

interface LoaderData {
  lead: LeadWithFields;
}

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { shop, redirect: shopRedirect } = await getAuthenticatedShop(request);
  const leadId = params.id;

  if (!leadId) {
    throw shopRedirect("/app/leads");
  }

  const lead = await getLeadById(shop.id, leadId);

  if (!lead) {
    throw shopRedirect("/app/leads");
  }

  return { lead };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { shop, redirect: shopRedirect } = await getAuthenticatedShop(request);
  const leadId = params.id;

  if (!leadId) {
    return { success: false, error: "Lead not found" };
  }

  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  try {
    if (intent === "updateStatus") {
      const status = formData.get("status") as LeadStatus;
      const reviewNotes = formData.get("reviewNotes") as string | null;

      await updateLeadStatus(shop.id, leadId, {
        status,
        reviewNotes: reviewNotes || undefined,
      });
      return { success: true, message: `Lead marked as ${status.toLowerCase()}` };
    }

    if (intent === "deleteLead") {
      await deleteLead(shop.id, leadId);
      throw redirect("/app/leads");
    }

    return { success: false, error: "Unknown action" };
  } catch (error) {
    if (error instanceof Response) throw error;
    console.error("Lead action error:", error);
    return { success: false, error: "An error occurred" };
  }
};

function formatDate(date: Date | string): string {
  return new Date(date).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getFieldTypeLabel(type: string): string {
  switch (type) {
    case "TEXT":
      return "Text";
    case "TEXTAREA":
      return "Textarea";
    case "SELECT":
      return "Select";
    case "CHECKBOX":
      return "Checkbox";
    case "ADDRESS":
      return "Address";
    default:
      return type;
  }
}

export default function LeadDetailPage() {
  const { lead } = useLoaderData<LoaderData>();
  const navigate = useNavigate();
  const shopify = useAppBridge();
  const fetcher = useFetcher();

  const [reviewNotes, setReviewNotes] = useState(lead.reviewNotes || "");

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

  const handleStatusChange = (status: LeadStatus) => {
    fetcher.submit(
      { intent: "updateStatus", status, reviewNotes },
      { method: "post" }
    );
  };

  const handleDelete = () => {
    if (confirm("Are you sure you want to delete this lead? This action cannot be undone.")) {
      fetcher.submit(
        { intent: "deleteLead" },
        { method: "post" }
      );
    }
  };

  const formData = lead.formData as Record<string, unknown>;
  const formFields = lead.formFields || [];

  // Get field value with proper formatting
  const getFieldValue = (fieldName: string, fieldType: string): string => {
    const value = formData[fieldName];
    if (value === undefined || value === null || value === "") return "—";
    if (fieldType === "CHECKBOX") return value ? "Yes" : "No";
    return String(value);
  };

  // Get address components for ADDRESS field type
  const getAddressComponents = (fieldName: string) => {
    return {
      street: formData[`${fieldName}_street`] as string | undefined,
      street_2: formData[`${fieldName}_street_2`] as string | undefined,
      city: formData[`${fieldName}_city`] as string | undefined,
      state: formData[`${fieldName}_state`] as string | undefined,
      zip: formData[`${fieldName}_zip`] as string | undefined,
      country: formData[`${fieldName}_country`] as string | undefined,
    };
  };

  // Get all address component keys to filter them from extra fields
  const addressComponentKeys = formFields
    .filter((f) => f.fieldType === "ADDRESS")
    .flatMap((f) => [
      `${f.name}_street`,
      `${f.name}_street_2`,
      `${f.name}_city`,
      `${f.name}_state`,
      `${f.name}_zip`,
      `${f.name}_country`,
    ]);

  // Find display name - prefer company_name or first text field
  const displayName =
    (formData["company_name"] as string) ||
    (formData["contact_name"] as string) ||
    "Lead Details";

  const isSubmitting = fetcher.state !== "idle";

  return (
    <s-page heading={displayName}>
      <s-link slot="breadcrumb-actions" href="/app/leads">
        Leads
      </s-link>

      <s-button slot="secondary-actions" variant="tertiary" onClick={handleDelete}>
        Delete
      </s-button>

      {/* Status Section */}
      <s-section>
        <s-grid gridTemplateColumns="2fr 1fr" gap="large">
          <s-stack gap="base">
            <s-stack direction="inline" gap="base" alignItems="center">
              <s-heading>Status</s-heading>
              <LeadStatusBadge status={lead.status} />
            </s-stack>

            <s-stack direction="inline" gap="small-200">
              {lead.status !== "REVIEWED" && (
                <s-button
                  variant="secondary"
                  onClick={() => handleStatusChange("REVIEWED")}
                  disabled={isSubmitting}
                >
                  Mark as Reviewed
                </s-button>
              )}
              {lead.status !== "APPROVED" && (
                <s-button
                  variant="primary"
                  onClick={() => handleStatusChange("APPROVED")}
                  disabled={isSubmitting}
                >
                  Approve
                </s-button>
              )}
              {lead.status !== "REJECTED" && (
                <s-button
                  variant="tertiary"
                  onClick={() => handleStatusChange("REJECTED")}
                  disabled={isSubmitting}
                >
                  Reject
                </s-button>
              )}
            </s-stack>

            <s-text-area
              label="Review Notes"
              value={reviewNotes}
              onInput={(e: Event) => setReviewNotes((e.target as HTMLTextAreaElement).value)}
              rows={3}
              placeholder="Add notes about this lead..."
            />
          </s-stack>

          <s-stack gap="small-200">
            <s-text>Submitted</s-text>
            <s-text color="subdued">{formatDate(lead.submittedAt)}</s-text>

            {lead.reviewedAt && (
              <>
                <s-text>Reviewed</s-text>
                <s-text color="subdued">{formatDate(lead.reviewedAt)}</s-text>
              </>
            )}
          </s-stack>
        </s-grid>
      </s-section>

      {/* Form Data Section */}
      <s-section>
        <s-stack gap="base">
          <s-heading>Submitted Information</s-heading>

          <s-table>
            <s-table-header-row>
              <s-table-header>Field</s-table-header>
              <s-table-header>Value</s-table-header>
              <s-table-header>Type</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {formFields
                .filter((f) => f.isActive || formData[f.name] !== undefined)
                .sort((a, b) => a.position - b.position)
                .map((field) => {
                  const isAddress = field.fieldType === "ADDRESS";
                  const addressComponents = isAddress ? getAddressComponents(field.name) : null;
                  const hasComponents = addressComponents && (
                    addressComponents.street ||
                    addressComponents.street_2 ||
                    addressComponents.city ||
                    addressComponents.state ||
                    addressComponents.zip ||
                    addressComponents.country
                  );

                  return (
                    <s-table-row key={field.id}>
                      <s-table-cell>
                        <s-stack gap="none">
                          <s-text>{field.label}</s-text>
                          <s-text color="subdued">{field.name}</s-text>
                        </s-stack>
                      </s-table-cell>
                      <s-table-cell>
                        {isAddress && hasComponents ? (
                          <s-stack gap="small-100">
                            <s-text>{getFieldValue(field.name, field.fieldType)}</s-text>
                            <s-stack gap="none">
                              {addressComponents.street && (
                                <s-text color="subdued">Street: {addressComponents.street}</s-text>
                              )}
                              {addressComponents.street_2 && (
                                <s-text color="subdued">Suite/Unit: {addressComponents.street_2}</s-text>
                              )}
                              {(addressComponents.city || addressComponents.state || addressComponents.zip) && (
                                <s-text color="subdued">
                                  {[addressComponents.city, addressComponents.state, addressComponents.zip]
                                    .filter(Boolean)
                                    .join(", ")}
                                </s-text>
                              )}
                              {addressComponents.country && (
                                <s-text color="subdued">{addressComponents.country}</s-text>
                              )}
                            </s-stack>
                          </s-stack>
                        ) : (
                          <s-text>{getFieldValue(field.name, field.fieldType)}</s-text>
                        )}
                      </s-table-cell>
                      <s-table-cell>
                        <s-badge>{getFieldTypeLabel(field.fieldType)}</s-badge>
                      </s-table-cell>
                    </s-table-row>
                  );
                })}

              {/* Show any extra fields in formData not in formFields (excluding address components) */}
              {Object.entries(formData)
                .filter(([key]) => !formFields.some((f) => f.name === key) && !addressComponentKeys.includes(key))
                .map(([key, value]) => (
                  <s-table-row key={key}>
                    <s-table-cell>
                      <s-text>{key}</s-text>
                    </s-table-cell>
                    <s-table-cell>
                      <s-text>
                        {typeof value === "boolean" ? (value ? "Yes" : "No") : String(value || "—")}
                      </s-text>
                    </s-table-cell>
                    <s-table-cell>
                      <s-badge>Unknown</s-badge>
                    </s-table-cell>
                  </s-table-row>
                ))}
            </s-table-body>
          </s-table>
        </s-stack>
      </s-section>

      {/* Raw Data Section (Collapsed) */}
      <s-section>
        <s-stack gap="base">
          <s-heading>Raw Data</s-heading>
          <s-box padding="base" background="subdued" borderRadius="base">
            <pre style={{ fontSize: "12px", overflow: "auto", margin: 0 }}>
              {JSON.stringify(formData, null, 2)}
            </pre>
          </s-box>
        </s-stack>
      </s-section>
    </s-page>
  );
}
