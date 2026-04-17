import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { useAppBridge, SaveBar } from "@shopify/app-bridge-react";

interface StateOption {
  code: string;
  name: string;
}

export interface TerritoryFormData {
  name: string;
  code: string;
  description: string;
  stateCodes: string[];
  zipcodes: string[];
}

interface TerritoryData {
  id?: string;
  name: string;
  code: string | null;
  description: string | null;
  stateCodes: string[];
  zipcodes: string[];
}

interface TerritoryFormProps {
  territory?: TerritoryData;
  states: readonly StateOption[];
  onSubmit: (data: TerritoryFormData) => void;
  onCancel: () => void;
  actionError?: string;
}

const defaultValues: TerritoryFormData = {
  name: "",
  code: "",
  description: "",
  stateCodes: [],
  zipcodes: [],
};

function territoryToFormData(territory?: TerritoryData): TerritoryFormData {
  if (!territory) return defaultValues;
  return {
    name: territory.name || "",
    code: territory.code || "",
    description: territory.description || "",
    stateCodes: territory.stateCodes || [],
    zipcodes: territory.zipcodes || [],
  };
}

export function TerritoryForm({
  territory,
  states,
  onSubmit,
  onCancel,
  actionError,
}: TerritoryFormProps) {
  const shopify = useAppBridge();

  // Store initial values in a ref so they're stable across renders
  const initialValuesRef = useRef<TerritoryFormData>(territoryToFormData(territory));

  // Form state
  const [formData, setFormData] = useState<TerritoryFormData>(initialValuesRef.current);

  // State search
  const [stateSearch, setStateSearch] = useState("");
  const [showStateDropdown, setShowStateDropdown] = useState(false);

  // Zipcode input
  const [zipcodeInput, setZipcodeInput] = useState("");
  const [zipcodeError, setZipcodeError] = useState("");

  // Check if form has changes compared to initial
  const isDirty = JSON.stringify(formData) !== JSON.stringify(initialValuesRef.current);

  // Helper to update form fields
  const updateField = useCallback(<K extends keyof TerritoryFormData>(
    field: K,
    value: TerritoryFormData[K]
  ) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  }, []);

  // Handle discard action from save bar
  const handleDiscard = useCallback(() => {
    setFormData(initialValuesRef.current);
    setStateSearch("");
    setZipcodeInput("");
    shopify.saveBar.hide("territory-form-save-bar");
  }, [shopify]);

  // Handle save action from save bar
  const handleSave = useCallback(() => {
    onSubmit(formData);
  }, [formData, onSubmit]);

  // Show/hide save bar based on dirty state
  useEffect(() => {
    if (isDirty) {
      shopify.saveBar.show("territory-form-save-bar");
    } else {
      shopify.saveBar.hide("territory-form-save-bar");
    }
  }, [isDirty, shopify]);

  // Filter states based on search
  const filteredStates = useMemo(() => {
    if (!stateSearch.trim()) return states;
    const search = stateSearch.toLowerCase();
    return states.filter(
      s => s.name.toLowerCase().includes(search) || s.code.toLowerCase().includes(search)
    );
  }, [states, stateSearch]);

  // Get selected state objects
  const selectedStates = useMemo(() => {
    return states.filter(s => formData.stateCodes.includes(s.code));
  }, [states, formData.stateCodes]);

  // Add state
  const addState = useCallback((stateCode: string) => {
    if (!formData.stateCodes.includes(stateCode)) {
      updateField("stateCodes", [...formData.stateCodes, stateCode]);
    }
    setStateSearch("");
    setShowStateDropdown(false);
  }, [formData.stateCodes, updateField]);

  // Remove state
  const removeState = useCallback((stateCode: string) => {
    updateField("stateCodes", formData.stateCodes.filter(s => s !== stateCode));
  }, [formData.stateCodes, updateField]);

  // Add zipcode with validation
  const addZipcode = useCallback(() => {
    const zip = zipcodeInput.trim();

    if (!zip) {
      return;
    }

    // Validate 5-digit ZIP code
    if (!/^\d{5}$/.test(zip)) {
      setZipcodeError("Please enter a valid 5-digit ZIP code");
      return;
    }

    if (formData.zipcodes.includes(zip)) {
      setZipcodeError("This ZIP code is already added");
      return;
    }

    setZipcodeError("");
    updateField("zipcodes", [...formData.zipcodes, zip]);
    setZipcodeInput("");
  }, [zipcodeInput, formData.zipcodes, updateField]);

  // Remove zipcode
  const removeZipcode = useCallback((zip: string) => {
    updateField("zipcodes", formData.zipcodes.filter(z => z !== zip));
  }, [formData.zipcodes, updateField]);

  // Available states (not yet selected)
  const availableStates = useMemo(() => {
    return filteredStates.filter(s => !formData.stateCodes.includes(s.code));
  }, [filteredStates, formData.stateCodes]);

  return (
    <>
      <SaveBar id="territory-form-save-bar">
        <button variant="primary" onClick={handleSave}></button>
        <button onClick={handleDiscard}></button>
      </SaveBar>

      <s-stack gap="base">
        <s-section>
          {actionError && (
            <s-banner tone="critical">{actionError}</s-banner>
          )}

          <s-text-field
            label="Territory Name"
            value={formData.name}
            onInput={(e: Event) => {
              const target = e.target as HTMLInputElement;
              updateField("name", target.value);
            }}
            required
          />

          <s-text-field
            label="Territory Code"
            value={formData.code}
            onInput={(e: Event) => {
              const target = e.target as HTMLInputElement;
              updateField("code", target.value);
            }}
            placeholder="Optional identifier (e.g., WEST-001)"
          />

          <s-text-field
            label="Description"
            value={formData.description}
            onInput={(e: Event) => {
              const target = e.target as HTMLInputElement;
              updateField("description", target.value);
            }}
          />
        </s-section>

        <s-section heading="Regions">
          {/* States Multi-Select */}
          <s-stack gap="base">
            <s-stack gap="none">
              <s-text>States</s-text>
              <s-text color="subdued">
                Select states to include in this territory
              </s-text>
            </s-stack>

            {/* Selected States Chips */}
            {selectedStates.length > 0 && (
              <s-stack direction="inline" gap="small-200">
                {selectedStates.map((state) => (
                  <s-badge key={state.code} tone="info">
                    <s-text>{state.name}</s-text>
                    <s-button onClick={() => removeState(state.code)} variant="tertiary" icon="delete" />
                  </s-badge>
                ))}
              </s-stack>
            )}

            {/* State Search Input */}
            <s-text-field
              label="Search states"
              labelAccessibilityVisibility="exclusive"
              placeholder="Search and select states..."
              autocomplete={"off"}
              value={stateSearch}
              onInput={(e: Event) => {
                const target = e.target as HTMLInputElement;
                setStateSearch(target.value);
                setShowStateDropdown(true);
              }}
              onFocus={() => setShowStateDropdown(true)}
              onBlur={() => {
                // Delay hiding to allow click on option
                setTimeout(() => setShowStateDropdown(false), 200);
              }}
            />

            {/* Dropdown */}
            {showStateDropdown && availableStates.length > 0 && (
              <s-box background="subdued" borderRadius="base" padding="small-500">
                <div style={{ maxHeight: "300px", overflowY: "auto" }}>
                  <s-stack gap="none">
                    {availableStates.map((state) => (
                      <s-button
                        key={state.code}
                        variant="tertiary"
                        onClick={() => addState(state.code)}
                      >
                        {state.name} ({state.code})
                      </s-button>
                    ))}
                  </s-stack>
                </div>
              </s-box>
            )}

            {/* ZIP Codes with Chips */}
            <s-stack gap="base">
              <s-stack gap="none">
                <s-text>ZIP Codes</s-text>
                <s-text color="subdued">
                  Enter ZIP codes to include in this territory
                </s-text>
              </s-stack>

              {/* Selected ZIP Code Chips */}
              {formData.zipcodes.length > 0 && (
                <s-stack direction="inline" gap="small-200">
                  {formData.zipcodes.map((zip) => (
                    <s-badge key={zip}>
                      {zip}
                      <s-button
                        variant="tertiary"
                        onClick={() => removeZipcode(zip)}
                        icon="delete"
                      />
                    </s-badge>
                  ))}
                </s-stack>
              )}

              {/* ZIP Code Input */}
              <div
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addZipcode();
                  }
                }}
              >
                <s-text-field
                  label="Add ZIP code"
                  labelAccessibilityVisibility="exclusive"
                  placeholder="Enter ZIP code and press Enter..."
                  autocomplete={"off"}
                  value={zipcodeInput}
                  minLength={1}
                  maxLength={5}
                  error={zipcodeError || undefined}
                  onInput={(e: Event) => {
                    const target = e.target as HTMLInputElement;
                    setZipcodeInput(target.value);
                    if (zipcodeError) setZipcodeError("");
                  }}
                />
              </div>
            </s-stack>
          </s-stack>
        </s-section>
      </s-stack>
    </>
  );
}
