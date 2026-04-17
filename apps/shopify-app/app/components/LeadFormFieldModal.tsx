import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import type { LeadFormField, LeadFieldType } from "@field-sales/database";

export const LEAD_FIELD_MODAL_ID = "lead-form-field-modal";

interface LeadFormFieldModalProps {
  editingField?: LeadFormField;
  onClose: () => void;
}

const FIELD_TYPES: { value: LeadFieldType; label: string; description: string }[] = [
  { value: "TEXT", label: "Text", description: "Single line text input" },
  { value: "TEXTAREA", label: "Textarea", description: "Multi-line text input" },
  { value: "SELECT", label: "Select", description: "Dropdown with options" },
  { value: "CHECKBOX", label: "Checkbox", description: "Yes/No checkbox" },
  { value: "ADDRESS", label: "Address", description: "Google Places autocomplete" },
];

/**
 * Generate a URL-safe field name from label
 */
function generateFieldName(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, "_")
    .substring(0, 50);
}

export function LeadFormFieldModal({ editingField, onClose }: LeadFormFieldModalProps) {
  const shopify = useAppBridge();
  const fetcher = useFetcher();
  const formRef = useRef<HTMLFormElement>(null);
  const isEdit = !!editingField;

  // Form state
  const [label, setLabel] = useState(editingField?.label || "");
  const [name, setName] = useState(editingField?.name || "");
  const [fieldType, setFieldType] = useState<LeadFieldType>(editingField?.fieldType || "TEXT");
  const [placeholder, setPlaceholder] = useState(editingField?.placeholder || "");
  const [options, setOptions] = useState(editingField?.options?.join("\n") || "");
  const [isRequired, setIsRequired] = useState(editingField?.isRequired ?? false);

  // Auto-generate name from label when creating new field
  const [nameManuallyEdited, setNameManuallyEdited] = useState(isEdit);

  // Reset state when editingField changes
  useEffect(() => {
    setLabel(editingField?.label || "");
    setName(editingField?.name || "");
    setFieldType(editingField?.fieldType || "TEXT");
    setPlaceholder(editingField?.placeholder || "");
    setOptions(editingField?.options?.join("\n") || "");
    setIsRequired(editingField?.isRequired ?? false);
    setNameManuallyEdited(!!editingField);
  }, [editingField]);

  // Auto-generate name from label
  useEffect(() => {
    if (!nameManuallyEdited && label) {
      setName(generateFieldName(label));
    }
  }, [label, nameManuallyEdited]);

  // Close modal and show toast on successful save
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.success) {
      const modalEl = document.getElementById(LEAD_FIELD_MODAL_ID) as HTMLElement & { hideOverlay: () => void };
      modalEl?.hideOverlay();
      formRef.current?.reset();
      if (fetcher.data.message) {
        shopify.toast.show(fetcher.data.message);
      }
    }
    if (fetcher.state === "idle" && fetcher.data?.error) {
      shopify.toast.show(fetcher.data.error, { isError: true });
    }
  }, [fetcher.state, fetcher.data, shopify]);

  // Handle modal hide event to clear state
  useEffect(() => {
    const modalEl = document.getElementById(LEAD_FIELD_MODAL_ID);
    const handleHide = () => {
      formRef.current?.reset();
      setLabel("");
      setName("");
      setFieldType("TEXT");
      setPlaceholder("");
      setOptions("");
      setIsRequired(false);
      setNameManuallyEdited(false);
      onClose();
    };
    modalEl?.addEventListener("hide", handleHide);
    return () => modalEl?.removeEventListener("hide", handleHide);
  }, [onClose]);

  const showOptions = fieldType === "SELECT";

  const handleDelete = () => {
    if (!editingField) return;
    if (confirm(`Are you sure you want to permanently delete the "${editingField.label}" field? This cannot be undone.`)) {
      fetcher.submit(
        { intent: "permanentlyDeleteField", fieldId: editingField.id },
        { method: "post" }
      );
    }
  };

  return (
    <s-modal
      id={LEAD_FIELD_MODAL_ID}
      heading={isEdit ? "Edit Field" : "Add Field"}
    >
      <s-stack gap="base">
        <fetcher.Form method="post" ref={formRef}>
          <input type="hidden" name="intent" value={isEdit ? "updateField" : "createField"} />
          {isEdit && <input type="hidden" name="fieldId" value={editingField.id} />}

          <s-stack gap="base">
            <s-text-field
              label="Field Label"
              name="label"
              value={label}
              onInput={(e: Event) => setLabel((e.target as HTMLInputElement).value)}
              required
              placeholder="e.g., Company Name"
            />

            <s-stack gap="small-200">
              <s-text-field
                label="Field Name"
                name="name"
                value={name}
                onInput={(e: Event) => {
                  setName((e.target as HTMLInputElement).value);
                  setNameManuallyEdited(true);
                }}
                required
                placeholder="e.g., company_name"
              />
              <s-text color="subdued">Internal identifier (lowercase, underscores). Auto-generated from label.</s-text>
            </s-stack>

            <s-select
              label="Field Type"
              name="fieldType"
              value={fieldType}
              onChange={(e: Event) => setFieldType((e.target as HTMLSelectElement).value as LeadFieldType)}
            >
              {FIELD_TYPES.map((type) => (
                <s-option key={type.value} value={type.value}>
                  {type.label} - {type.description}
                </s-option>
              ))}
            </s-select>

            {!showOptions && fieldType !== "CHECKBOX" && (
              <s-text-field
                label="Placeholder"
                name="placeholder"
                value={placeholder}
                onInput={(e: Event) => setPlaceholder((e.target as HTMLInputElement).value)}
                placeholder="Optional placeholder text"
              />
            )}

            {showOptions && (
              <s-stack gap="small-200">
                <s-text-area
                  label="Options (one per line)"
                  name="options"
                  value={options}
                  onInput={(e: Event) => setOptions((e.target as HTMLTextAreaElement).value)}
                  rows={5}
                  required
                  placeholder="Restaurant&#10;Retail&#10;Wholesale&#10;Other"
                />
                <s-text color="subdued">Enter each dropdown option on a new line</s-text>
              </s-stack>
            )}

            <s-checkbox
              label="Required field"
              name="isRequired"
              checked={isRequired}
              onChange={(e: Event) => setIsRequired((e.target as HTMLInputElement).checked)}
            />
          </s-stack>
        </fetcher.Form>

        <s-divider />

        <s-button
          variant="tertiary"
          tone="critical"
          onClick={handleDelete}
          disabled={fetcher.state !== "idle"}
          icon="delete"
        >
          Delete Field
        </s-button>
      </s-stack>

      <s-button slot="secondary-actions" commandFor={LEAD_FIELD_MODAL_ID} command="--hide">
        Cancel
      </s-button>
      <s-button
        slot="primary-action"
        variant="primary"
        disabled={fetcher.state !== "idle"}
        onClick={() => formRef.current?.requestSubmit()}
      >
        {fetcher.state !== "idle" ? "Saving..." : isEdit ? "Update Field" : "Add Field"}
      </s-button>
    </s-modal>
  );
}
