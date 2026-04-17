import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { getActiveLeadFormFields, createLead, type LeadFormField } from "../services/lead.server";

// Google Maps API key from environment
const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY || "";

/**
 * Render the form as Liquid content to inherit store theme
 * Using Content-Type: application/liquid makes Shopify render this within the store's layout
 */
function renderFormLiquid(
  fields: LeadFormField[],
  shopDomain: string,
  googleMapsApiKey: string,
  error?: string,
  success?: boolean
): string {
  // Check if any ADDRESS fields exist
  const hasAddressField = fields.some((f) => f.fieldType === "ADDRESS");

  const formFieldsHtml = fields
    .map((field) => {
      const required = field.isRequired ? "required" : "";
      const requiredMark = field.isRequired ? ' <span class="fsm-required">*</span>' : "";

      switch (field.fieldType) {
        case "TEXT":
          const isPhone = field.name.toLowerCase().includes("phone");
          const isEmail = field.name.toLowerCase().includes("email");
          const inputType = isEmail ? "email" : isPhone ? "tel" : "text";
          const phoneAttr = isPhone ? 'data-fsm-phone="true"' : "";
          const emailAttr = isEmail ? 'data-fsm-email="true"' : "";
          const defaultPlaceholder = isPhone ? "(555) 123-4567" : isEmail ? "name@company.com" : "";
          return `
            <div class="fsm-field">
              <label class="fsm-label" for="fsm-${field.name}">${field.label}${requiredMark}</label>
              <input
                class="fsm-input"
                type="${inputType}"
                id="fsm-${field.name}"
                name="${field.name}"
                placeholder="${field.placeholder || defaultPlaceholder}"
                ${phoneAttr}
                ${emailAttr}
                ${required}
              />
              ${isEmail ? `<div class="fsm-field-error" id="fsm-${field.name}_error"></div>` : ""}
            </div>
          `;

        case "TEXTAREA":
          return `
            <div class="fsm-field">
              <label class="fsm-label" for="fsm-${field.name}">${field.label}${requiredMark}</label>
              <textarea
                class="fsm-input fsm-textarea"
                id="fsm-${field.name}"
                name="${field.name}"
                rows="4"
                placeholder="${field.placeholder || ""}"
                ${required}
              ></textarea>
            </div>
          `;

        case "SELECT":
          const options = field.options
            .map((opt: string) => `<option value="${opt}">${opt}</option>`)
            .join("");
          return `
            <div class="fsm-field">
              <label class="fsm-label" for="fsm-${field.name}">${field.label}${requiredMark}</label>
              <select class="fsm-input fsm-select" id="fsm-${field.name}" name="${field.name}" ${required}>
                <option value="">Select...</option>
                ${options}
              </select>
            </div>
          `;

        case "CHECKBOX":
          return `
            <div class="fsm-field fsm-checkbox-field">
              <label class="fsm-checkbox-label">
                <input type="checkbox" name="${field.name}" value="true" ${required} />
                <span>${field.label}${requiredMark}</span>
              </label>
            </div>
          `;

        case "ADDRESS":
          // Address field with autocomplete dropdown and hidden fields for components
          return `
            <div class="fsm-field fsm-address-wrapper">
              <label class="fsm-label" for="fsm-${field.name}">${field.label}${requiredMark}</label>
              <div class="fsm-address-container">
                <input
                  class="fsm-input"
                  type="text"
                  id="fsm-${field.name}"
                  name="${field.name}"
                  placeholder="${field.placeholder || "Start typing an address..."}"
                  autocomplete="off"
                  data-fsm-address="true"
                  ${required}
                />
                <div class="fsm-suggestions" id="fsm-${field.name}_suggestions"></div>
              </div>
              <input
                class="fsm-input"
                type="text"
                id="fsm-${field.name}_street_2"
                name="${field.name}_street_2"
                placeholder="Suite, Unit, Apt, etc. (optional)"
                style="margin-top: 0.5rem;"
              />
              <input type="hidden" name="${field.name}_street" id="fsm-${field.name}_street" />
              <input type="hidden" name="${field.name}_city" id="fsm-${field.name}_city" />
              <input type="hidden" name="${field.name}_state" id="fsm-${field.name}_state" />
              <input type="hidden" name="${field.name}_zip" id="fsm-${field.name}_zip" />
              <input type="hidden" name="${field.name}_country" id="fsm-${field.name}_country" />
            </div>
          `;

        default:
          return "";
      }
    })
    .join("\n");

  const errorHtml = error
    ? `<div class="fsm-message fsm-error">${error}</div>`
    : "";

  const successHtml = success
    ? `<div class="fsm-message fsm-success">Thank you! Your information has been submitted successfully. We'll be in touch soon.</div>`
    : "";

  // Google Places API script (only if ADDRESS field exists and API key is configured)
  // Using the new Places API with loading=async
  const googleMapsScript = hasAddressField && googleMapsApiKey
    ? `<script src="https://maps.googleapis.com/maps/api/js?key=${googleMapsApiKey}&libraries=places&loading=async&callback=initFsmAutocomplete" async defer></script>`
    : "";

  // Autocomplete initialization script using the new Places API
  const autocompleteScript = hasAddressField && googleMapsApiKey
    ? `
<script>
function initFsmAutocomplete() {
  var addressInputs = document.querySelectorAll('[data-fsm-address="true"]');

  addressInputs.forEach(function(input) {
    var fieldName = input.name;
    var suggestionsContainer = document.getElementById('fsm-' + fieldName + '_suggestions');
    var sessionToken = new google.maps.places.AutocompleteSessionToken();
    var debounceTimer = null;

    // Handle input changes
    input.addEventListener('input', function() {
      var query = input.value.trim();

      if (debounceTimer) clearTimeout(debounceTimer);

      if (query.length < 3) {
        suggestionsContainer.classList.remove('active');
        suggestionsContainer.innerHTML = '';
        return;
      }

      debounceTimer = setTimeout(function() {
        fetchSuggestions(query);
      }, 300);
    });

    // Hide suggestions when clicking outside
    document.addEventListener('click', function(e) {
      if (!input.contains(e.target) && !suggestionsContainer.contains(e.target)) {
        suggestionsContainer.classList.remove('active');
      }
    });

    // Show suggestions on focus if we have a value
    input.addEventListener('focus', function() {
      if (suggestionsContainer.children.length > 0) {
        suggestionsContainer.classList.add('active');
      }
    });

    async function fetchSuggestions(query) {
      suggestionsContainer.innerHTML = '<div class="fsm-suggestions-loading">Searching...</div>';
      suggestionsContainer.classList.add('active');

      try {
        var request = {
          input: query,
          sessionToken: sessionToken
        };

        var response = await google.maps.places.AutocompleteSuggestion.fetchAutocompleteSuggestions(request);

        if (!response.suggestions || response.suggestions.length === 0) {
          suggestionsContainer.innerHTML = '<div class="fsm-suggestions-loading">No addresses found</div>';
          return;
        }

        suggestionsContainer.innerHTML = '';

        response.suggestions.forEach(function(suggestion) {
          var div = document.createElement('div');
          div.className = 'fsm-suggestion';
          div.innerHTML = '<div class="fsm-suggestion-main">' + suggestion.placePrediction.mainText.text + '</div>' +
            '<div class="fsm-suggestion-secondary">' + (suggestion.placePrediction.secondaryText ? suggestion.placePrediction.secondaryText.text : '') + '</div>';

          div.addEventListener('click', function() {
            selectPlace(suggestion.placePrediction.placeId);
          });

          suggestionsContainer.appendChild(div);
        });
      } catch (error) {
        console.error('Error fetching suggestions:', error);
        suggestionsContainer.innerHTML = '<div class="fsm-suggestions-loading">Error loading suggestions</div>';
      }
    }

    async function selectPlace(placeId) {
      suggestionsContainer.classList.remove('active');
      suggestionsContainer.innerHTML = '';

      try {
        var place = new google.maps.places.Place({ id: placeId });
        await place.fetchFields({ fields: ['addressComponents', 'formattedAddress'] });

        // Create new session token for next search
        sessionToken = new google.maps.places.AutocompleteSessionToken();

        var street = '';
        var city = '';
        var state = '';
        var zip = '';
        var country = '';

        if (place.addressComponents) {
          place.addressComponents.forEach(function(component) {
            var types = component.types;

            if (types.includes('street_number')) {
              street = component.longText + ' ';
            }
            if (types.includes('route')) {
              street = street + component.longText;
            }
            if (types.includes('locality')) {
              city = component.longText;
            }
            if (types.includes('administrative_area_level_1')) {
              state = component.shortText;
            }
            if (types.includes('postal_code')) {
              zip = component.longText;
            }
            if (types.includes('country')) {
              country = component.longText;
            }
          });
        }

        // Update form fields
        input.value = place.formattedAddress || '';
        document.getElementById('fsm-' + fieldName + '_street').value = street.trim();
        document.getElementById('fsm-' + fieldName + '_city').value = city;
        document.getElementById('fsm-' + fieldName + '_state').value = state;
        document.getElementById('fsm-' + fieldName + '_zip').value = zip;
        document.getElementById('fsm-' + fieldName + '_country').value = country;

      } catch (error) {
        console.error('Error fetching place details:', error);
      }
    }
  });
}
</script>
`
    : "";

  // Return Liquid content - Shopify will wrap this in the store's theme layout
  return `
{% layout 'theme' %}

<style>
  /* Minimal styles that complement the theme rather than override it */
  .fsm-form-container {
    max-width: 600px;
    margin: 0 auto;
    padding: 2rem 1rem;
  }

  .fsm-form-header {
    margin-bottom: 2rem;
    text-align: center;
  }

  .fsm-form-title {
    margin-bottom: 0.5rem;
  }

  .fsm-form-subtitle {
    opacity: 0.7;
  }

  .fsm-field {
    margin-bottom: 1.25rem;
  }

  .fsm-label {
    display: block;
    margin-bottom: 0.5rem;
    font-weight: 500;
  }

  .fsm-required {
    color: #c00;
  }

  .fsm-input {
    width: 100%;
    padding: 0.75rem;
    border: 1px solid rgba(0, 0, 0, 0.15);
    border-radius: 4px;
    font-family: inherit;
    font-size: inherit;
    background-color: transparent;
    color: inherit;
    transition: border-color 0.2s;
  }

  .fsm-input:focus {
    outline: none;
    border-color: currentColor;
  }

  .fsm-textarea {
    resize: vertical;
    min-height: 100px;
  }

  .fsm-select {
    cursor: pointer;
  }

  .fsm-checkbox-field {
    display: flex;
    align-items: flex-start;
  }

  .fsm-checkbox-label {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    cursor: pointer;
    font-weight: normal;
  }

  .fsm-checkbox-label input {
    width: auto;
    margin: 0;
  }

  .fsm-submit-btn {
    width: 100%;
    padding: 1rem;
    margin-top: 1rem;
    border: none;
    border-radius: 4px;
    font-family: inherit;
    font-size: inherit;
    font-weight: 600;
    cursor: pointer;
    background-color: rgba(0, 0, 0, 0.9);
    color: #fff;
    transition: opacity 0.2s;
  }

  .fsm-submit-btn:hover {
    opacity: 0.85;
  }

  .fsm-submit-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .fsm-message {
    padding: 1rem;
    border-radius: 4px;
    margin-bottom: 1.5rem;
  }

  .fsm-error {
    background-color: rgba(200, 0, 0, 0.1);
    border: 1px solid rgba(200, 0, 0, 0.3);
    color: #c00;
  }

  .fsm-success {
    background-color: rgba(0, 128, 0, 0.1);
    border: 1px solid rgba(0, 128, 0, 0.3);
    color: #060;
  }

  .fsm-privacy {
    margin-top: 1.5rem;
    padding-top: 1rem;
    border-top: 1px solid rgba(0, 0, 0, 0.1);
    font-size: 0.875em;
    opacity: 0.7;
    text-align: center;
  }

  /* Address autocomplete styles */
  .fsm-address-container {
    position: relative;
  }

  .fsm-suggestions {
    position: absolute;
    top: 100%;
    left: 0;
    right: 0;
    z-index: 1000;
    background: #fff;
    border: 1px solid rgba(0, 0, 0, 0.15);
    border-top: none;
    border-radius: 0 0 4px 4px;
    max-height: 250px;
    overflow-y: auto;
    display: none;
    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
  }

  .fsm-suggestions.active {
    display: block;
  }

  .fsm-suggestion {
    padding: 0.75rem;
    cursor: pointer;
    border-bottom: 1px solid rgba(0, 0, 0, 0.05);
  }

  .fsm-suggestion:last-child {
    border-bottom: none;
  }

  .fsm-suggestion:hover {
    background-color: rgba(0, 0, 0, 0.05);
  }

  .fsm-suggestion-main {
    font-weight: 500;
  }

  .fsm-suggestion-secondary {
    font-size: 0.85em;
    opacity: 0.7;
    margin-top: 0.25rem;
  }

  .fsm-suggestions-loading {
    padding: 0.75rem;
    text-align: center;
    opacity: 0.7;
  }

  /* Field validation styles */
  .fsm-input.fsm-input-error {
    border-color: #c00;
  }

  .fsm-input.fsm-input-valid {
    border-color: #060;
  }

  .fsm-field-error {
    color: #c00;
    font-size: 0.85em;
    margin-top: 0.25rem;
    display: none;
  }

  .fsm-field-error.active {
    display: block;
  }

  /* Google Places Autocomplete dropdown styling */
  .pac-container {
    font-family: inherit;
    border-radius: 4px;
    border: 1px solid rgba(0, 0, 0, 0.15);
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.1);
  }

  .pac-item {
    padding: 0.5rem 0.75rem;
    cursor: pointer;
  }

  .pac-item:hover {
    background-color: rgba(0, 0, 0, 0.05);
  }

  .pac-item-query {
    font-size: inherit;
  }
</style>

<div class="fsm-form-container">
  <div class="fsm-form-header">
    <h1 class="fsm-form-title">Become a Partner</h1>
    <p class="fsm-form-subtitle">Fill out the form below and we'll get in touch with you.</p>
  </div>

  ${errorHtml}
  ${successHtml}

  ${
    success
      ? ""
      : `
  <form method="POST" id="fsm-lead-form">
    <input type="hidden" name="shop" value="${shopDomain}" />
    ${formFieldsHtml}
    <button type="submit" class="fsm-submit-btn">Submit</button>
  </form>
  `
  }

  <p class="fsm-privacy">
    Your information will be handled according to our privacy policy.
  </p>
</div>

<script>
  document.getElementById('fsm-lead-form')?.addEventListener('submit', function(e) {
    var button = this.querySelector('.fsm-submit-btn');
    button.disabled = true;
    button.textContent = 'Submitting...';
  });
</script>

<script>
  // Phone number masking - formats as (XXX) XXX-XXXX or +XXX (XXX) XXX-XXXX for international
  // Max 13 digits: 3-digit country code + 10-digit local number
  (function() {
    var phoneInputs = document.querySelectorAll('[data-fsm-phone="true"]');

    phoneInputs.forEach(function(input) {
      input.addEventListener('input', function(e) {
        var value = e.target.value;
        var digits = value.replace(/[^0-9]/g, '');

        // Cap at 13 digits (3-digit country code + 10-digit local)
        if (digits.length > 13) {
          digits = digits.slice(0, 13);
        }

        if (digits.length === 0) {
          e.target.value = '';
          return;
        }

        var formatted = '';

        if (digits.length <= 10) {
          // US format: (XXX) XXX-XXXX
          if (digits.length > 6) {
            formatted = '(' + digits.slice(0, 3) + ') ' + digits.slice(3, 6) + '-' + digits.slice(6, 10);
          } else if (digits.length > 3) {
            formatted = '(' + digits.slice(0, 3) + ') ' + digits.slice(3, 6);
          } else {
            formatted = '(' + digits.slice(0, 3);
          }
        } else {
          // International: +XXX (XXX) XXX-XXXX
          var countryCode = digits.slice(0, digits.length - 10);
          var localNumber = digits.slice(-10);
          formatted = '+' + countryCode + ' (' + localNumber.slice(0, 3) + ') ' + localNumber.slice(3, 6) + '-' + localNumber.slice(6, 10);
        }

        e.target.value = formatted;
      });

      input.addEventListener('paste', function(e) {
        setTimeout(function() {
          input.dispatchEvent(new Event('input'));
        }, 0);
      });
    });
  })();
</script>

<script>
  // Email validation - checks for valid email format
  (function() {
    var emailInputs = document.querySelectorAll('[data-fsm-email="true"]');
    var emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

    emailInputs.forEach(function(input) {
      var errorEl = document.getElementById(input.id + '_error');

      function validateEmail() {
        var value = input.value.trim();

        if (value.length === 0) {
          // Empty - remove validation styling
          input.classList.remove('fsm-input-error', 'fsm-input-valid');
          if (errorEl) {
            errorEl.classList.remove('active');
            errorEl.textContent = '';
          }
          return;
        }

        if (emailRegex.test(value)) {
          // Valid email
          input.classList.remove('fsm-input-error');
          input.classList.add('fsm-input-valid');
          if (errorEl) {
            errorEl.classList.remove('active');
            errorEl.textContent = '';
          }
        } else {
          // Invalid email
          input.classList.remove('fsm-input-valid');
          input.classList.add('fsm-input-error');
          if (errorEl) {
            errorEl.classList.add('active');
            errorEl.textContent = 'Please enter a valid email address';
          }
        }
      }

      input.addEventListener('blur', validateEmail);
      input.addEventListener('input', function() {
        // Only show valid state while typing, show error on blur
        var value = input.value.trim();
        if (value.length > 0 && emailRegex.test(value)) {
          input.classList.remove('fsm-input-error');
          input.classList.add('fsm-input-valid');
          if (errorEl) {
            errorEl.classList.remove('active');
          }
        } else if (input.classList.contains('fsm-input-error')) {
          // Re-validate if already showing error
          validateEmail();
        }
      });
    });
  })();
</script>

${autocompleteScript}
${googleMapsScript}
`;
}

/**
 * GET - Render the lead form
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  // Use Shopify's built-in app proxy authentication
  const { session } = await authenticate.public.appProxy(request);
  const shopDomain = session?.shop;

  if (!shopDomain) {
    return new Response(
      renderFormLiquid([], "", GOOGLE_MAPS_API_KEY, "Invalid request - missing shop parameter"),
      {
        status: 400,
        headers: { "Content-Type": "application/liquid" },
      }
    );
  }

  // Get shop
  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: shopDomain },
  });

  if (!shop) {
    return new Response(
      renderFormLiquid([], shopDomain, GOOGLE_MAPS_API_KEY, "Shop not found"),
      {
        status: 404,
        headers: { "Content-Type": "application/liquid" },
      }
    );
  }

  // Get active form fields
  const fields = await getActiveLeadFormFields(shop.id);

  if (fields.length === 0) {
    return new Response(
      renderFormLiquid([], shopDomain, GOOGLE_MAPS_API_KEY, "Form is not configured yet. Please try again later."),
      {
        status: 200,
        headers: { "Content-Type": "application/liquid" },
      }
    );
  }

  return new Response(renderFormLiquid(fields, shopDomain, GOOGLE_MAPS_API_KEY), {
    status: 200,
    headers: { "Content-Type": "application/liquid" },
  });
};

/**
 * POST - Handle form submission
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  // Use Shopify's built-in app proxy authentication
  const { session } = await authenticate.public.appProxy(request);

  const formData = await request.formData();
  // Use shop from session, fallback to form data for compatibility
  const shopDomain = session?.shop || (formData.get("shop") as string);

  if (!shopDomain) {
    return new Response(
      renderFormLiquid([], "", GOOGLE_MAPS_API_KEY, "Invalid submission - missing shop"),
      {
        status: 400,
        headers: { "Content-Type": "application/liquid" },
      }
    );
  }

  // Get shop
  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: shopDomain },
  });

  if (!shop) {
    return new Response(
      renderFormLiquid([], shopDomain, GOOGLE_MAPS_API_KEY, "Shop not found"),
      {
        status: 404,
        headers: { "Content-Type": "application/liquid" },
      }
    );
  }

  // Get active form fields for validation
  const fields = await getActiveLeadFormFields(shop.id);

  // Build form data object and validate required fields
  const leadFormData: Record<string, unknown> = {};
  const errors: string[] = [];

  for (const field of fields) {
    const value = formData.get(field.name);

    if (field.fieldType === "CHECKBOX") {
      leadFormData[field.name] = value === "true";
      if (field.isRequired && value !== "true") {
        errors.push(`${field.label} is required`);
      }
    } else if (field.fieldType === "ADDRESS") {
      // For address fields, store the full address and components
      const strValue = (value as string)?.trim() || "";
      leadFormData[field.name] = strValue;

      // Also store the parsed components
      leadFormData[`${field.name}_street`] = (formData.get(`${field.name}_street`) as string)?.trim() || "";
      leadFormData[`${field.name}_street_2`] = (formData.get(`${field.name}_street_2`) as string)?.trim() || "";
      leadFormData[`${field.name}_city`] = (formData.get(`${field.name}_city`) as string)?.trim() || "";
      leadFormData[`${field.name}_state`] = (formData.get(`${field.name}_state`) as string)?.trim() || "";
      leadFormData[`${field.name}_zip`] = (formData.get(`${field.name}_zip`) as string)?.trim() || "";
      leadFormData[`${field.name}_country`] = (formData.get(`${field.name}_country`) as string)?.trim() || "";

      if (field.isRequired && !strValue) {
        errors.push(`${field.label} is required`);
      }
    } else {
      const strValue = (value as string)?.trim() || "";
      leadFormData[field.name] = strValue;

      if (field.isRequired && !strValue) {
        errors.push(`${field.label} is required`);
      }

      // Basic email validation
      if (field.name === "email" && strValue) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(strValue)) {
          errors.push("Please enter a valid email address");
        }
      }
    }
  }

  // If validation errors, show form with errors
  if (errors.length > 0) {
    return new Response(
      renderFormLiquid(fields, shopDomain, GOOGLE_MAPS_API_KEY, errors.join(". ")),
      {
        status: 400,
        headers: { "Content-Type": "application/liquid" },
      }
    );
  }

  // Create the lead
  try {
    await createLead({
      shopId: shop.id,
      formData: leadFormData,
    });

    return new Response(renderFormLiquid(fields, shopDomain, GOOGLE_MAPS_API_KEY, undefined, true), {
      status: 200,
      headers: { "Content-Type": "application/liquid" },
    });
  } catch (error) {
    console.error("Error creating lead:", error);
    return new Response(
      renderFormLiquid(fields, shopDomain, GOOGLE_MAPS_API_KEY, "An error occurred. Please try again."),
      {
        status: 500,
        headers: { "Content-Type": "application/liquid" },
      }
    );
  }
};
