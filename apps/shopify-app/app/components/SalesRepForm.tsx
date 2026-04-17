import { useState, useRef, useCallback, useEffect } from "react";
import { useAppBridge, SaveBar } from "@shopify/app-bridge-react";
import { TerritoryPicker, type Territory } from "./TerritoryPicker";

// Phone number utilities
function normalizePhone(value: string): string {
  // Strip to digits only, limit to 10 digits
  return value.replace(/\D/g, "").slice(0, 10);
}

function formatPhone(normalized: string): string {
  if (!normalized) return "";
  const digits = normalized.replace(/\D/g, "");
  if (digits.length === 0) return "";
  if (digits.length <= 3) return `(${digits}`;
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6, 10)}`;
}

function isValidPhone(normalized: string): boolean {
  // Valid if empty or exactly 10 digits
  return normalized.length === 0 || normalized.length === 10;
}

// Email validation
function isValidEmail(email: string): boolean {
  if (!email) return true; // Empty is valid (use required for mandatory)
  // Standard email regex - allows most valid emails
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

export interface SalesRepFormData {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  externalId: string;
  role: "REP" | "MANAGER" | "ADMIN";
  territoryIds: string[];
  requiresOrderApproval: boolean;
  approvalThresholdDollars: string; // Stored as string for input, converted to cents on submit
}

interface SalesRepData {
  id?: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  externalId: string | null;
  role: "REP" | "MANAGER" | "ADMIN";
  territoryIds: string[];
  approvalThresholdCents: number | null;
}

interface SalesRepFormProps {
  rep?: SalesRepData;
  /** Initial territories for edit mode (maps IDs to names) */
  territories: Territory[];
  onSubmit: (data: SalesRepFormData) => void;
  onCancel: () => void;
}

const defaultValues: SalesRepFormData = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  externalId: "",
  role: "REP",
  territoryIds: [],
  requiresOrderApproval: true,
  approvalThresholdDollars: "0",
};

function repToFormData(rep?: SalesRepData): SalesRepFormData {
  if (!rep) return defaultValues;

  // Convert approvalThresholdCents to form values
  // null = no approval required (checkbox unchecked)
  // 0+ = approval required, show threshold
  const requiresOrderApproval = rep.approvalThresholdCents !== null;
  const approvalThresholdDollars = rep.approvalThresholdCents !== null
    ? (rep.approvalThresholdCents / 100).toString()
    : "0";

  return {
    firstName: rep.firstName || "",
    lastName: rep.lastName || "",
    email: rep.email || "",
    phone: rep.phone || "",
    externalId: rep.externalId || "",
    role: rep.role || "REP",
    territoryIds: rep.territoryIds || [],
    requiresOrderApproval,
    approvalThresholdDollars,
  };
}

export function SalesRepForm({
  rep,
  territories,
  onSubmit,
  onCancel,
}: SalesRepFormProps) {
  const shopify = useAppBridge();
  const isEdit = !!rep?.id;

  // Store initial values in a ref so they're stable across renders
  const initialValuesRef = useRef<SalesRepFormData>(repToFormData(rep));

  // Form state
  const [formData, setFormData] = useState<SalesRepFormData>(initialValuesRef.current);

  // Territory picker state - convert IDs to full objects using the territories prop
  const initialSelectedTerritories = territories.filter((t) =>
    initialValuesRef.current.territoryIds.includes(t.id)
  );
  const [selectedTerritories, setSelectedTerritories] = useState<Territory[]>(initialSelectedTerritories);

  // Load territories from API for the picker
  const loadTerritories = useCallback(async (): Promise<Territory[]> => {
    const response = await fetch("/api/territories");
    const data = await response.json();
    return data.territories || [];
  }, []);

  // Handle territory selection
  const handleTerritorySelect = useCallback((selected: Territory[]) => {
    setSelectedTerritories(selected);
    setFormData((prev) => ({
      ...prev,
      territoryIds: selected.map((t) => t.id),
    }));
  }, []);

  // Check if form has changes compared to initial
  const isDirty = JSON.stringify(formData) !== JSON.stringify(initialValuesRef.current);

  // Helper to update form fields
  const updateField = useCallback(<K extends keyof SalesRepFormData>(
    field: K,
    value: SalesRepFormData[K]
  ) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  }, []);

  // Handle discard action from save bar
  const handleDiscard = useCallback(() => {
    setFormData(initialValuesRef.current);
    shopify.saveBar.hide("sales-rep-form-save-bar");
  }, [shopify]);

  // Handle save action from save bar
  const handleSave = useCallback(() => {
    onSubmit(formData);
  }, [formData, onSubmit]);

  // Show/hide save bar based on dirty state
  useEffect(() => {
    if (isDirty) {
      shopify.saveBar.show("sales-rep-form-save-bar");
    } else {
      shopify.saveBar.hide("sales-rep-form-save-bar");
    }
  }, [isDirty, shopify]);


  return (
    <>
      <SaveBar id="sales-rep-form-save-bar">
        <button variant="primary" onClick={handleSave}></button>
        <button onClick={handleDiscard}></button>
      </SaveBar>

      <s-stack gap="base">
        <s-grid gridTemplateColumns="repeat(2, 1fr)" gap="base">
          <s-grid-item>
            <s-text-field
              label="First Name"
              value={formData.firstName}
              onInput={(e: Event) => {
                const target = e.target as HTMLInputElement;
                updateField("firstName", target.value);
              }}
              required
            />
          </s-grid-item>
          <s-grid-item>
            <s-text-field
              label="Last Name"
              value={formData.lastName}
              onInput={(e: Event) => {
                const target = e.target as HTMLInputElement;
                updateField("lastName", target.value);
              }}
              required
            />
          </s-grid-item>
          <s-grid-item>
            <s-email-field
              label="Email"
              value={formData.email}
              onInput={(e: Event) => {
                const target = e.target as HTMLInputElement;
                updateField("email", target.value.trim());
              }}
              error={formData.email && !isValidEmail(formData.email) ? "Enter a valid email address" : undefined}
              required
            />
          </s-grid-item>
          <s-grid-item>
            <s-text-field
              label="Phone"
              value={formatPhone(formData.phone)}
              onInput={(e: Event) => {
                const target = e.target as HTMLInputElement;
                updateField("phone", normalizePhone(target.value));
              }}
              error={formData.phone && !isValidPhone(formData.phone) ? "Enter a valid 10-digit phone number" : undefined}
              placeholder="(555) 123-4567"
            />
          </s-grid-item>
          <s-grid-item>
            <s-text-field
              label="External ID"
              value={formData.externalId}
              onInput={(e: Event) => {
                const target = e.target as HTMLInputElement;
                updateField("externalId", target.value);
              }}
              placeholder="Optional business identifier"
            />
          </s-grid-item>
          <s-grid-item gridColumn="span 2">
            <s-select
              label="Role"
              value={formData.role}
              onChange={(e: Event) => {
                const target = e.target as HTMLSelectElement;
                updateField("role", target.value as "REP" | "MANAGER" | "ADMIN");
              }}
            >
              <s-option value="REP">Sales Rep</s-option>
              <s-option value="MANAGER">Sales Manager</s-option>
              <s-option value="ADMIN">Admin</s-option>
            </s-select>
          </s-grid-item>
        </s-grid>

        <s-divider />

        <s-stack gap="base">
          <s-heading>Order Approval</s-heading>
          <s-checkbox
            label="Require order approval"
            checked={formData.requiresOrderApproval}
            onChange={(e: Event) => {
              const target = e.target as HTMLInputElement;
              updateField("requiresOrderApproval", target.checked);
            }}
          />
          {formData.requiresOrderApproval && (
            <s-stack gap="small-200">
              <s-number-field
                label="Minimum order amount for approval"
                value={formData.approvalThresholdDollars}
                onInput={(e: Event) => {
                  const target = e.target as HTMLInputElement;
                  // Only allow non-negative numbers
                  const value = Math.max(0, parseFloat(target.value) || 0).toString();
                  updateField("approvalThresholdDollars", value);
                }}
                prefix="$"
                min={0}
              />
              <s-text color="subdued">
                Orders at or above this amount will require approval. Set to $0 to require approval for all orders.
              </s-text>
            </s-stack>
          )}
        </s-stack>

        <s-divider />

        <s-stack gap="base">
          <s-heading>Assigned Territories</s-heading>
          <TerritoryPicker
            heading="Assign territories"
            selectedTerritories={selectedTerritories}
            onSelect={handleTerritorySelect}
            onLoadTerritories={loadTerritories}
          />
        </s-stack>

      </s-stack>
    </>
  );
}
