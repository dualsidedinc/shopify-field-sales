import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useLoaderData, useFetcher } from "react-router";
import { useState, useEffect, useRef } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";
import { getAuthenticatedShop } from "../services/shop.server";
import {
  getLeadFormFields,
  createLeadFormField,
  updateLeadFormField,
  deleteLeadFormField,
  permanentlyDeleteLeadFormField,
  reorderLeadFormFields,
  seedDefaultFormFields,
  type LeadFormField,
  type LeadFieldType,
} from "../services/lead.server";
import { LeadFormFieldModal, LEAD_FIELD_MODAL_ID } from "../components/LeadFormFieldModal";

interface LoaderData {
  shopId: string;
  formFields: LeadFormField[];
  formUrl: string;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop } = await getAuthenticatedShop(request);

  // Get form fields, or seed defaults if none exist
  let formFields = await getLeadFormFields(shop.id);
  if (formFields.length === 0) {
    formFields = await seedDefaultFormFields(shop.id);
  }

  // Build the proxy URL for the public form
  // Shop URL: /apps/{subpath}/... forwards to app at /{url}/...
  const formUrl = `https://${shop.shopifyDomain}/apps/fsm/lead-form`;

  return {
    shopId: shop.id,
    formFields,
    formUrl,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop } = await getAuthenticatedShop(request);
  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  try {
    if (intent === "createField") {
      const label = formData.get("label") as string;
      const name = formData.get("name") as string;
      const fieldType = formData.get("fieldType") as LeadFieldType;
      const placeholder = formData.get("placeholder") as string | null;
      const optionsStr = formData.get("options") as string | null;
      const options = optionsStr
        ? optionsStr.split("\n").map((o) => o.trim()).filter(Boolean)
        : [];
      const isRequired = formData.get("isRequired") === "on";

      await createLeadFormField({
        shopId: shop.id,
        label,
        name,
        fieldType,
        placeholder: placeholder || undefined,
        options,
        isRequired,
      });
      return { success: true, message: "Field created" };
    }

    if (intent === "updateField") {
      const fieldId = formData.get("fieldId") as string;
      const label = formData.get("label") as string;
      const name = formData.get("name") as string;
      const fieldType = formData.get("fieldType") as LeadFieldType;
      const placeholder = formData.get("placeholder") as string | null;
      const optionsStr = formData.get("options") as string | null;
      const options = optionsStr
        ? optionsStr.split("\n").map((o) => o.trim()).filter(Boolean)
        : [];
      const isRequired = formData.get("isRequired") === "on";

      await updateLeadFormField(fieldId, {
        label,
        name,
        fieldType,
        placeholder: placeholder || null,
        options,
        isRequired,
      });
      return { success: true, message: "Field updated" };
    }

    if (intent === "deleteField") {
      const fieldId = formData.get("fieldId") as string;
      await deleteLeadFormField(fieldId);
      return { success: true, message: "Field deactivated" };
    }

    if (intent === "toggleField") {
      const fieldId = formData.get("fieldId") as string;
      const isActive = formData.get("isActive") === "true";
      await updateLeadFormField(fieldId, { isActive: !isActive });
      return { success: true, message: isActive ? "Field deactivated" : "Field activated" };
    }

    if (intent === "permanentlyDeleteField") {
      const fieldId = formData.get("fieldId") as string;
      await permanentlyDeleteLeadFormField(fieldId);
      return { success: true, message: "Field permanently deleted" };
    }

    if (intent === "reorderFields") {
      const orderedIdsJson = formData.get("orderedIds") as string;
      const orderedIds = JSON.parse(orderedIdsJson) as string[];
      await reorderLeadFormFields(shop.id, orderedIds);
      return { success: true, message: "Fields reordered" };
    }

    return { success: false, error: "Unknown action" };
  } catch (error) {
    console.error("Form builder action error:", error);
    const message = error instanceof Error ? error.message : "An error occurred";
    return { success: false, error: message };
  }
};

function getFieldTypeLabel(type: LeadFieldType): string {
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

export default function LeadFormBuilderPage() {
  const { formFields, formUrl } = useLoaderData<LoaderData>();
  const shopify = useAppBridge();
  const fetcher = useFetcher();

  const [editingField, setEditingField] = useState<LeadFormField | undefined>();

  // Track if we've processed the current fetcher result
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

  const handleEditField = (field: LeadFormField) => {
    setEditingField(field);
    const modalEl = document.getElementById(LEAD_FIELD_MODAL_ID) as HTMLElement & { showOverlay: () => void };
    modalEl?.showOverlay();
  };

  const handleCloseModal = () => {
    setEditingField(undefined);
  };

  const handleToggleField = (field: LeadFormField) => {
    fetcher.submit(
      { intent: "toggleField", fieldId: field.id, isActive: field.isActive.toString() },
      { method: "post" }
    );
  };

  const handleDeleteField = (field: LeadFormField) => {
    if (confirm(`Are you sure you want to deactivate "${field.label}"?`)) {
      fetcher.submit(
        { intent: "deleteField", fieldId: field.id },
        { method: "post" }
      );
    }
  };

  const handlePermanentlyDeleteField = (field: LeadFormField) => {
    if (confirm(`Are you sure you want to permanently delete "${field.label}"? This cannot be undone.`)) {
      fetcher.submit(
        { intent: "permanentlyDeleteField", fieldId: field.id },
        { method: "post" }
      );
    }
  };

  const activeFields = formFields.filter((f) => f.isActive).sort((a, b) => a.position - b.position);

  const handleMoveField = (fieldId: string, direction: "up" | "down") => {
    const currentIndex = activeFields.findIndex((f) => f.id === fieldId);
    if (currentIndex === -1) return;

    const newIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
    if (newIndex < 0 || newIndex >= activeFields.length) return;

    // Create new order
    const newFields = [...activeFields];
    const [movedField] = newFields.splice(currentIndex, 1);
    newFields.splice(newIndex, 0, movedField);

    // Submit the new order
    fetcher.submit(
      {
        intent: "reorderFields",
        orderedIds: JSON.stringify(newFields.map((f) => f.id)),
      },
      { method: "post" }
    );
  };
  const inactiveFields = formFields.filter((f) => !f.isActive);

  return (
    <s-page heading="Form Builder">
      <s-link slot="breadcrumb-actions" href="/app/leads">
        Leads
      </s-link>

      <s-button slot="primary-action" commandFor={LEAD_FIELD_MODAL_ID} command="--show">
        Add Field
      </s-button>

      {/* Modal */}
      <LeadFormFieldModal editingField={editingField} onClose={handleCloseModal} />

      {/* Form URL Section */}
      <s-section>
        <s-stack gap="base">
          <s-stack gap="small-200">
            <s-heading>Public Form URL</s-heading>
            <s-text color="subdued">
              Share this URL with potential leads to collect their information.
            </s-text>
          </s-stack>
          <s-box padding="base" background="subdued" borderRadius="base">
            <s-stack direction="inline" gap="base" alignItems="center">
              <s-text>{formUrl}</s-text>
              <s-button
                variant="tertiary"
                onClick={() => {
                  navigator.clipboard.writeText(formUrl);
                  shopify.toast.show("URL copied to clipboard");
                }}
              >
                Copy
              </s-button>
            </s-stack>
          </s-box>
          <s-text color="subdued">
            Note: You must configure the App Proxy in your Shopify Partner Dashboard for this URL to work.
          </s-text>
        </s-stack>
      </s-section>

      {/* Active Fields Section */}
      <s-section>
        <s-stack gap="base">
          <s-stack direction="inline" gap="small-200" justifyContent="space-between" alignItems="center">
            <s-heading>Form Fields ({activeFields.length})</s-heading>
          </s-stack>

          {activeFields.length > 0 ? (
            <s-table>
              <s-table-header-row>
                <s-table-header style={{ width: "70px" }}>Order</s-table-header>
                <s-table-header>Label</s-table-header>
                <s-table-header>Name</s-table-header>
                <s-table-header>Type</s-table-header>
                <s-table-header>Required</s-table-header>
                <s-table-header>Options</s-table-header>
                <s-table-header></s-table-header>
              </s-table-header-row>
              <s-table-body>
                {activeFields.map((field, index) => (
                  <s-table-row key={field.id}>
                    <s-table-cell>
                      <s-stack direction="inline" gap="small-100">
                        <s-button
                          variant="tertiary"
                          icon="chevron-up"
                          size="slim"
                          accessibilityLabel="Move up"
                          disabled={index === 0}
                          onClick={() => handleMoveField(field.id, "up")}
                        />
                        <s-button
                          variant="tertiary"
                          icon="chevron-down"
                          size="slim"
                          accessibilityLabel="Move down"
                          disabled={index === activeFields.length - 1}
                          onClick={() => handleMoveField(field.id, "down")}
                        />
                      </s-stack>
                    </s-table-cell>
                    <s-table-cell>
                      <s-text>{field.label}</s-text>
                    </s-table-cell>
                    <s-table-cell>
                      <s-text color="subdued">{field.name}</s-text>
                    </s-table-cell>
                    <s-table-cell>
                      <s-badge>{getFieldTypeLabel(field.fieldType)}</s-badge>
                    </s-table-cell>
                    <s-table-cell>
                      {field.isRequired ? (
                        <s-badge tone="warning">Required</s-badge>
                      ) : (
                        <s-text color="subdued">Optional</s-text>
                      )}
                    </s-table-cell>
                    <s-table-cell>
                      {field.fieldType === "SELECT" && field.options.length > 0 ? (
                        <s-text color="subdued">{field.options.length} options</s-text>
                      ) : (
                        <s-text color="subdued">—</s-text>
                      )}
                    </s-table-cell>
                    <s-table-cell>
                      <s-stack direction="inline" gap="small-200">
                        <s-button
                          variant="tertiary"
                          icon="edit"
                          accessibilityLabel="Edit"
                          onClick={() => handleEditField(field)}
                        />
                        <s-button
                          variant="tertiary"
                          icon="hide"
                          accessibilityLabel="Deactivate"
                          onClick={() => handleToggleField(field)}
                        />
                      </s-stack>
                    </s-table-cell>
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>
          ) : (
            <s-box padding="large">
              <s-text color="subdued">No form fields configured. Add one to get started.</s-text>
            </s-box>
          )}
        </s-stack>
      </s-section>

      {/* Inactive Fields Section */}
      {inactiveFields.length > 0 && (
        <s-section>
          <s-stack gap="base">
            <s-stack gap="small-200">
              <s-heading>Inactive Fields ({inactiveFields.length})</s-heading>
              <s-text color="subdued">
                These fields are hidden from the form but preserved for historical data.
              </s-text>
            </s-stack>

            <s-table>
              <s-table-header-row>
                <s-table-header>Label</s-table-header>
                <s-table-header>Name</s-table-header>
                <s-table-header>Type</s-table-header>
                <s-table-header></s-table-header>
              </s-table-header-row>
              <s-table-body>
                {inactiveFields.map((field) => (
                  <s-table-row key={field.id}>
                    <s-table-cell>
                      <s-text color="subdued">{field.label}</s-text>
                    </s-table-cell>
                    <s-table-cell>
                      <s-text color="subdued">{field.name}</s-text>
                    </s-table-cell>
                    <s-table-cell>
                      <s-badge>{getFieldTypeLabel(field.fieldType)}</s-badge>
                    </s-table-cell>
                    <s-table-cell>
                      <s-stack direction="inline" gap="small-200">
                        <s-button
                          variant="tertiary"
                          onClick={() => handleToggleField(field)}
                        >
                          Activate
                        </s-button>
                        <s-button
                          variant="tertiary"
                          tone="critical"
                          onClick={() => handlePermanentlyDeleteField(field)}
                        >
                          Delete
                        </s-button>
                      </s-stack>
                    </s-table-cell>
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>
          </s-stack>
        </s-section>
      )}

      {/* Preview Section */}
      <s-section>
        <s-stack gap="base">
          <s-heading>Form Preview</s-heading>
          <s-text color="subdued">
            This is how your lead form will appear to visitors.
          </s-text>

          <s-box padding="large" background="subdued" borderRadius="base">
            <div style={{ maxWidth: "500px" }}>
              <s-stack gap="base">
                {activeFields.map((field) => (
                  <div key={field.id}>
                    {field.fieldType === "TEXT" && (
                      <s-text-field
                        label={field.label}
                        placeholder={field.placeholder || ""}
                        required={field.isRequired}
                        disabled
                      />
                    )}
                    {field.fieldType === "TEXTAREA" && (
                      <s-text-area
                        label={field.label}
                        placeholder={field.placeholder || ""}
                        required={field.isRequired}
                        rows={3}
                        disabled
                      />
                    )}
                    {field.fieldType === "SELECT" && (
                      <s-select
                        label={field.label}
                        required={field.isRequired}
                        disabled
                      >
                        <s-option value="">Select...</s-option>
                        {field.options.map((opt: string) => (
                          <s-option key={opt} value={opt}>{opt}</s-option>
                        ))}
                      </s-select>
                    )}
                    {field.fieldType === "CHECKBOX" && (
                      <s-checkbox
                        label={`${field.label}${field.isRequired ? " *" : ""}`}
                        disabled
                      />
                    )}
                    {field.fieldType === "ADDRESS" && (
                      <s-text-field
                        label={field.label}
                        placeholder={field.placeholder || "Start typing an address..."}
                        required={field.isRequired}
                        disabled
                      />
                    )}
                  </div>
                ))}
                <s-button variant="primary" disabled>
                  Submit
                </s-button>
              </s-stack>
            </div>
          </s-box>
        </s-stack>
      </s-section>
    </s-page>
  );
}
