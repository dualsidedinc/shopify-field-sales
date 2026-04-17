import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import type { OrderStatus, PaymentTerms } from "@prisma/client";
import { useAppBridge } from "@shopify/app-bridge-react";
import { saveBar, picker } from "../utils/shopify-ui";
import { CompanyPicker, type Company } from "./CompanyPicker";
import { ContactPicker, type Contact } from "./ContactPicker";
import { LocationPicker, type Location } from "./LocationPicker";
import { Modal, ModalTrigger } from "./Modal";
import type { PromotionType, PromotionScope } from "@field-sales/shared";

// Types
export interface OrderLineItem {
  id: string;
  shopifyProductId: string | null;
  shopifyVariantId: string | null;
  sku: string | null;
  title: string;
  variantTitle: string | null;
  imageUrl?: string | null;
  quantity: number;
  unitPriceCents: number;
  discountCents: number;
  totalCents: number;
  isFreeItem?: boolean;              // True if added by promotion
  promotionId?: string | null;       // ID of promotion that added this item
  promotionName?: string | null;     // Name of promotion for display
}

export interface OrderCompany {
  id: string;
  name: string;
  accountNumber: string | null;
}

export interface OrderContact {
  id: string;
  name: string;
  email: string;
  phone?: string | null;
  paymentMethods?: PaymentMethod[];
}

export interface OrderLocation {
  id: string;
  name: string;
  address1: string | null;
  address2: string | null;
  city: string | null;
  province: string | null;
  provinceCode: string | null;
  zipcode: string | null;
  country: string;
  // Payment terms from Shopify B2B
  paymentTermsType?: string | null;
  paymentTermsDays?: number | null;
  checkoutToDraft?: boolean;
}

export interface PaymentMethod {
  id: string;
  provider: string;
  last4?: string;
  brand?: string;
  expiryMonth?: number;
  expiryYear?: number;
  isDefault: boolean;
}

export interface OrderPromotion {
  id: string;
  name: string;
  type: PromotionType;
  scope: PromotionScope;
  value: number;
  discountCents: number; // Calculated discount amount
}

export interface ShippingOption {
  id: string;
  name: string;
  priceCents: number;
  estimatedDays?: number;
}

export interface TaxLine {
  title: string;
  rate: number;
  amountCents: number;
}

export interface TaxCalculationInput {
  lineItems: Array<{
    shopifyVariantId?: string | null;
    title: string;
    quantity: number;
    unitPriceCents: number;
  }>;
  shippingAddress?: {
    address1?: string | null;
    city?: string | null;
    province?: string | null;
    zip?: string | null;
    countryCode?: string;
  } | null;
  customerId?: string | null;
  shippingCents?: number;
}

export interface TaxCalculationResult {
  taxCents: number;
  taxLines: TaxLine[];
}

export interface PromotionEvaluationInput {
  lineItems: Array<{
    id: string;
    shopifyProductId: string | null;
    shopifyVariantId: string | null;
    title: string;
    variantTitle?: string | null;
    sku?: string | null;
    quantity: number;
    unitPriceCents: number;
    isFreeItem?: boolean;
  }>;
}

export interface PromotionEvaluationResult {
  appliedPromotions: Array<{
    id: string;
    name: string;
    type: string;
    scope: string;
    discountCents: number;
  }>;
  freeItemsToAdd: Array<{
    productId: string;
    variantId: string;
    title: string;
    variantTitle?: string;
    sku?: string;
    quantity: number;
    unitPriceCents: number;
    promotionId: string;
    promotionName: string;
  }>;
  totalDiscountCents: number;
}

// Timeline types
export interface TimelineEvent {
  id: string;
  authorType: "SALES_REP" | "ADMIN" | "SYSTEM";
  authorId: string | null;
  authorName: string;
  eventType: string;
  metadata: Record<string, unknown> | null;
  comment: string | null;
  createdAt: string;
}

export interface OrderFormData {
  id?: string;
  orderNumber?: string;
  status?: OrderStatus;
  shopifyDraftOrderId?: string | null;
  shopifyOrderId?: string | null;
  shopifyOrderNumber?: string | null;
  company: OrderCompany | null;
  contact: OrderContact | null;
  salesRepName?: string;
  shippingLocation: OrderLocation | null;
  billingLocation: OrderLocation | null;
  lineItems: OrderLineItem[];
  appliedPromotions: OrderPromotion[];
  selectedShippingOption: ShippingOption | null;
  note: string;
  poNumber: string;
  paymentTerms: PaymentTerms;
  paymentMethodId?: string | null;
  paymentDueDate?: Date | null;
  subtotalCents: number;
  discountCents: number;
  shippingCents: number;
  taxCents: number;
  taxLines: TaxLine[];
  totalCents: number;
  currency: string;
}

export interface OrderFormProps {
  initialData?: Partial<OrderFormData>;
  mode: "create" | "edit";
  onSave: (data: OrderFormData) => void;
  onCancel: () => void;
  onSearchProducts?: (query: string) => Promise<ProductSearchResult[]>;
  onLoadProducts?: () => Promise<ProductSearchResult[]>;
  onLoadShippingOptions?: () => Promise<ShippingOption[]>;
  /** Pre-loaded shipping options - when provided, skips async loading */
  initialShippingOptions?: ShippingOption[];
  onLoadCompanies?: () => Promise<Company[]>;
  onLoadContacts?: () => Promise<Contact[]>;
  onLoadLocations?: () => Promise<Location[]>;
  /** Callback to calculate tax using Shopify's tax engine */
  onCalculateTax?: (input: TaxCalculationInput) => Promise<TaxCalculationResult>;
  /** Callback to evaluate promotions when line items change */
  onEvaluatePromotions?: (input: PromotionEvaluationInput) => Promise<PromotionEvaluationResult>;
  isSubmitting?: boolean;
  /** Callback when "Submit for Approval" is clicked (for DRAFT orders) - sets status to AWAITING_REVIEW */
  onSubmitForApproval?: (comment?: string) => void;
  /** Callback when "Approve Order" is clicked (for AWAITING_REVIEW orders) - submits to Shopify */
  onApprove?: (comment?: string, paymentMethodId?: string) => void;
  /** Callback when "Decline Order" is clicked (for AWAITING_REVIEW orders) */
  onDecline?: (comment?: string) => void;
  /** Callback to add a manual comment to the timeline */
  onAddComment?: (comment: string) => void;
  /** Shop domain for constructing Shopify admin links (e.g., "mystore.myshopify.com") */
  shopDomain?: string;
  /** When true, Company, Contact, Location, and Products sections are read-only */
  readonly?: boolean;
  /** Timeline events for the order */
  timelineEvents?: TimelineEvent[];
  /** Additional content to render after the main form (e.g., Shopify integration, actions) */
  children?: React.ReactNode;
}

export interface ProductSearchResult {
  id: string;
  shopifyProductId: string;
  shopifyVariantId: string;
  title: string;
  variantTitle: string | null;
  sku: string | null;
  imageUrl: string | null;
  priceCents: number;
}

// Helper functions
function formatCurrency(cents: number, currency: string = "USD"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(cents / 100);
}

function generateTempId(): string {
  return `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// Sub-components
function CompanySection({
  company,
  contact,
  shippingLocation,
  onCompanySelect,
  onContactSelect,
  onShippingLocationSelect,
  onLoadCompanies,
  onLoadContacts,
  onLoadLocations,
  onCompanySuccess,
  readonly = false,
}: {
  company: OrderCompany | null;
  contact: OrderContact | null;
  shippingLocation: OrderLocation | null;
  onCompanySelect: (company: OrderCompany | null) => void;
  onContactSelect: (contact: OrderContact | null) => void;
  onShippingLocationSelect: (location: OrderLocation | null) => void;
  onLoadCompanies?: () => Promise<Company[]>;
  onLoadContacts?: () => Promise<Contact[]>;
  onLoadLocations?: () => Promise<Location[]>;
  onCompanySuccess?: (companies: Company[]) => void;
  readonly?: boolean;
}) {
  const handleCompanySelect = useCallback((companies: Company[]) => {
    if (companies.length > 0) {
      const c = companies[0];
      onCompanySelect({
        id: c.id,
        name: c.name,
        accountNumber: c.accountNumber || null,
      });
      // Clear contact and location when company changes
      onContactSelect(null);
      onShippingLocationSelect(null);
    } else {
      onCompanySelect(null);
      onContactSelect(null);
      onShippingLocationSelect(null);
    }
  }, [onCompanySelect, onContactSelect, onShippingLocationSelect]);

  const handleContactSelect = useCallback((contacts: Contact[]) => {
    if (contacts.length > 0) {
      const c = contacts[0];
      onContactSelect({
        id: c.id,
        name: `${c.firstName} ${c.lastName}`,
        email: c.email,
        phone: c.phone || null,
        paymentMethods: c.paymentMethods,
      });
    } else {
      onContactSelect(null);
    }
  }, [onContactSelect]);

  const handleShippingLocationSelect = useCallback((locations: Location[]) => {
    if (locations.length > 0) {
      const l = locations[0];
      onShippingLocationSelect({
        id: l.id,
        name: l.name,
        address1: l.address1 || null,
        address2: l.address2 || null,
        city: l.city || null,
        province: l.province || null,
        provinceCode: l.provinceCode || null,
        zipcode: l.zipcode || null,
        country: l.country || "US",
        paymentTermsType: l.paymentTermsType || null,
        paymentTermsDays: l.paymentTermsDays || null,
        checkoutToDraft: l.checkoutToDraft || false,
      });
    } else {
      onShippingLocationSelect(null);
    }
  }, [onShippingLocationSelect]);

  // Map company to picker format
  const selectedCompanies: Company[] = company
    ? [{ id: company.id, name: company.name, accountNumber: company.accountNumber || undefined }]
    : [];

  // Map contact to picker format
  const selectedContacts: Contact[] = contact
    ? [{
        id: contact.id,
        companyId: company?.id || "",
        firstName: contact.name.split(" ")[0] || "",
        lastName: contact.name.split(" ").slice(1).join(" ") || "",
        email: contact.email,
        phone: contact.phone || undefined,
      }]
    : [];

  // Map location to picker format
  const selectedLocations: Location[] = shippingLocation
    ? [{
        id: shippingLocation.id,
        companyId: company?.id || "",
        name: shippingLocation.name,
        address1: shippingLocation.address1 || undefined,
        address2: shippingLocation.address2 || undefined,
        city: shippingLocation.city || undefined,
        province: shippingLocation.province || undefined,
        provinceCode: shippingLocation.provinceCode || undefined,
        zipcode: shippingLocation.zipcode || undefined,
        country: shippingLocation.country,
        isShippingAddress: true,
      }]
    : [];

  // Readonly view - show static info
  if (readonly) {
    return (
      <s-section heading="Company">
        <s-stack gap="base">
          {/* Company */}
          <s-box background="subdued" borderRadius="base" padding="base">
            <s-stack gap="small-200">
              <s-text type="strong">Company</s-text>
              {company ? (
                <s-text>{company.name}{company.accountNumber && ` (${company.accountNumber})`}</s-text>
              ) : (
                <s-text color="subdued">No company selected</s-text>
              )}
            </s-stack>
          </s-box>

          {/* Contact */}
          <s-box background="subdued" borderRadius="base" padding="base">
            <s-stack gap="small-200">
              <s-text type="strong">Contact</s-text>
              {contact ? (
                <s-stack gap="small-100">
                  <s-text>{contact.name}</s-text>
                  <s-text color="subdued">{contact.email}</s-text>
                </s-stack>
              ) : (
                <s-text color="subdued">No contact selected</s-text>
              )}
            </s-stack>
          </s-box>

          {/* Shipping Location */}
          <s-box background="subdued" borderRadius="base" padding="base">
            <s-stack gap="small-200">
              <s-text type="strong">Shipping Location</s-text>
              {shippingLocation ? (
                <s-stack gap="small-100">
                  <s-text>{shippingLocation.name}</s-text>
                  <s-text color="subdued">
                    {[
                      shippingLocation.address1,
                      shippingLocation.city,
                      shippingLocation.province,
                      shippingLocation.zipcode,
                    ].filter(Boolean).join(", ")}
                  </s-text>
                </s-stack>
              ) : (
                <s-text color="subdued">No location selected</s-text>
              )}
            </s-stack>
          </s-box>
        </s-stack>
      </s-section>
    );
  }

  return (
    <s-section heading="Company">
      {!company && onLoadCompanies ? (
        <CompanyPicker
          selectedCompanies={[]}
          onSelect={handleCompanySelect}
          onLoadCompanies={onLoadCompanies}
          selectButtonText="Select Company"
          changeButtonText="Change"
          emptyText=""
          onSuccess={onCompanySuccess}
        />
      ) : company && onLoadCompanies ? (
        <s-stack gap="base">
          <CompanyPicker
            selectedCompanies={selectedCompanies}
            onSelect={handleCompanySelect}
            onLoadCompanies={onLoadCompanies}
            selectButtonText="Select Company"
            changeButtonText="Change"
            emptyText=""
            onSuccess={onCompanySuccess}
          />

          {onLoadContacts && (
            <ContactPicker
              selectedContacts={selectedContacts}
              onSelect={handleContactSelect}
              onLoadContacts={onLoadContacts}
              companyId={company.id}
              selectButtonText="Select Contact"
              changeButtonText="Change"
              emptyText=""
            />
          )}

          {onLoadLocations && (
            <LocationPicker
              selectedLocations={selectedLocations}
              onSelect={handleShippingLocationSelect}
              onLoadLocations={onLoadLocations}
              companyId={company.id}
              shippingOnly
              selectButtonText="Select Shipping Location"
              changeButtonText="Change"
              emptyText=""
            />
          )}
        </s-stack>
      ) : null}
    </s-section>
  );
}

function ProductsSection({
  lineItems,
  currency,
  onUpdateQuantity,
  onRemoveItem,
  onSearchProducts,
  onLoadProducts,
  onAddProducts,
  readonly = false,
}: {
  lineItems: OrderLineItem[];
  currency: string;
  onUpdateQuantity: (itemId: string, quantity: number) => void;
  onRemoveItem: (itemId: string) => void;
  onSearchProducts?: (query: string) => Promise<ProductSearchResult[]>;
  onLoadProducts?: () => Promise<ProductSearchResult[]>;
  onAddProducts: (products: ProductSearchResult[]) => void;
  readonly?: boolean;
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<ProductSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showResults, setShowResults] = useState(false);

  const handleBrowseProducts = useCallback(async () => {
    if (!onLoadProducts) return;

    // Load available products
    const products = await onLoadProducts();

    // Open picker with product data
    const selectedIds = await picker.open({
      heading: "Select products",
      multiple: true,
      headers: [
        { content: "Product" },
        { content: "SKU" },
        { content: "Price", type: "number" },
      ],
      items: products.map((product) => ({
        id: product.id,
        heading: product.variantTitle
          ? `${product.title} - ${product.variantTitle}`
          : product.title,
        data: [
          product.sku || "—",
          formatCurrency(product.priceCents, currency),
        ],
        thumbnail: product.imageUrl ? { url: product.imageUrl } : undefined,
      })),
    });

    if (selectedIds) {
      // Find and add all selected products at once
      const selectedProducts = selectedIds
        .map((id) => products.find((p) => p.id === id))
        .filter((p): p is ProductSearchResult => p !== undefined);

      if (selectedProducts.length > 0) {
        onAddProducts(selectedProducts);
      }
    }
  }, [onLoadProducts, onAddProducts, currency]);

  const handleSearchInput = useCallback(async (e: Event) => {
    const value = (e.target as HTMLInputElement).value;
    setSearchQuery(value);

    if (onSearchProducts && value.length >= 2) {
      setIsSearching(true);
      setShowResults(true);
      try {
        const results = await onSearchProducts(value);
        setSearchResults(results);
      } catch {
        setSearchResults([]);
      } finally {
        setIsSearching(false);
      }
    } else {
      setSearchResults([]);
      setShowResults(false);
    }
  }, [onSearchProducts]);

  const handleSelectProduct = useCallback((product: ProductSearchResult) => {
    onAddProducts([product]);
    setSearchQuery("");
    setSearchResults([]);
    setShowResults(false);
  }, [onAddProducts]);

  const handleBlur = useCallback(() => {
    // Delay hiding to allow click on results
    setTimeout(() => setShowResults(false), 200);
  }, []);

  return (
    <s-section>
      <s-stack gap="base">
        <s-stack direction="inline" gap="small-200" justifyContent="space-between" alignItems="center">
          <s-heading>Products</s-heading>
          {!readonly && (
            <s-button variant="secondary" onClick={handleBrowseProducts}>
              Add Item
            </s-button>
          )}
        </s-stack>

        {/* Line items table */}
        {lineItems.length > 0 ? (
          <s-table>
            <s-table-header-row>
              <s-table-header>Product</s-table-header>
              <s-table-header>Price</s-table-header>
              <s-table-header>Quantity</s-table-header>
              <s-table-header>Total</s-table-header>
              {!readonly && <s-table-header></s-table-header>}
            </s-table-header-row>
            <s-table-body>
              {lineItems.map((item) => (
                <s-table-row key={item.id}>
                  <s-table-cell>
                    <s-stack direction="inline" gap="small-200" alignItems="center" wrap="nowrap">
                      {item.imageUrl ? (
                        <s-thumbnail src={item.imageUrl} alt={item.title} />
                      ) : (
                        <s-box
                          background="subdued"
                          borderRadius="base"
                          padding="small"
                          inlineSize="40px"
                          blockSize="40px"
                        >
                          <s-icon type={item.isFreeItem ? "discount" : "product"} />
                        </s-box>
                      )}
                      <s-stack direction="block" gap="small-100">
                        <s-text type="strong">{item.title}</s-text>
                        {item.variantTitle && (
                          <s-badge>{item.variantTitle}</s-badge>
                        )}
                        {item.isFreeItem && item.promotionName && (
                          <s-text color="subdued" type="caption">Free - {item.promotionName}</s-text>
                        )}
                      </s-stack>
                    </s-stack>
                  </s-table-cell>
                  <s-table-cell>
                    <s-text color="subdued">
                      {formatCurrency(item.unitPriceCents, currency)}
                    </s-text>
                  </s-table-cell>
                  <s-table-cell>
                    {readonly || item.isFreeItem ? (
                      <s-text>{item.quantity}</s-text>
                    ) : (
                      <s-box>
                        <s-number-field
                          label="Quantity"
                          labelAccessibilityVisibility="exclusive"
                          value={item.quantity.toString()}
                          min={1}
                          max={99}
                          onChange={(e: Event) => {
                            const value = parseInt((e.target as HTMLInputElement).value, 10);
                            if (!isNaN(value) && value > 0) {
                              onUpdateQuantity(item.id, value);
                            }
                          }}
                        />
                      </s-box>
                    )}
                  </s-table-cell>
                  <s-table-cell>
                    <s-text>{formatCurrency(item.totalCents, currency)}</s-text>
                  </s-table-cell>
                  {!readonly && (
                    <s-table-cell>
                      <s-button
                        variant="tertiary"
                        icon="x"
                        accessibilityLabel="Remove item"
                        onClick={() => onRemoveItem(item.id)}
                      />
                    </s-table-cell>
                  )}
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        ) : (
          <s-box padding="base" background="subdued" borderRadius="base">
            <s-stack gap="small-200" alignItems="center" justifyContent="center">
              <s-text color="subdued">No products added yet.</s-text>
            </s-stack>
          </s-box>
        )}
      </s-stack>
    </s-section>
  );
}

function OrderSummarySection({
  lineItems,
  subtotalCents,
  discountCents,
  selectedShippingOption,
  shippingCents,
  taxCents,
  totalCents,
  currency,
  shippingOptions,
  onSelectShipping,
  isCalculatingTax,
}: {
  lineItems: OrderLineItem[];
  subtotalCents: number;
  discountCents: number;
  selectedShippingOption: ShippingOption | null;
  shippingCents: number;
  taxCents: number;
  totalCents: number;
  currency: string;
  shippingOptions: ShippingOption[];
  onSelectShipping: (option: ShippingOption | null) => void;
  isCalculatingTax?: boolean;
}) {
  // Only count regular items (not free items)
  const regularItems = lineItems.filter(item => !item.isFreeItem);
  const itemCount = regularItems.reduce((sum, item) => sum + item.quantity, 0);

  return (
    <s-section heading="Order Summary">
      <s-stack direction="block" gap="small">
        <s-divider />

        {/* Subtotal */}
        <s-grid gridTemplateColumns="1fr auto auto" gap="base" alignItems="center">
          <s-text>Subtotal</s-text>
          <s-text color="subdued">{itemCount} {itemCount === 1 ? "item" : "items"}</s-text>
          <s-text>{formatCurrency(subtotalCents, currency)}</s-text>
        </s-grid>

        {/* Order Total Discount - shows order-level discounts (e.g., "Spend $1500, Get $100 Off") */}
        {discountCents > 0 && (
          <s-grid gridTemplateColumns="1fr auto" gap="base" alignItems="center">
            <s-text>Order Total Discount</s-text>
            <s-text>-{formatCurrency(discountCents, currency)}</s-text>
          </s-grid>
        )}

        {/* Shipping */}
        <s-grid gridTemplateColumns="1fr auto" gap="base" alignItems="center" justifyContent="space-between">
          <s-grid-item gridColumn="auto">
            <s-box>
              <s-select
                label="Shipping"
                labelAccessibilityVisibility="exclusive"
                value={selectedShippingOption?.id || ""}
                onChange={(e: Event) => {
                  const value = (e.target as HTMLSelectElement).value;
                  const option = shippingOptions.find((o) => o.id === value) || null;
                  onSelectShipping(option);
                }}
              >
                <s-option value="">Select shipping...</s-option>
                {shippingOptions.map((option) => (
                  <s-option key={option.id} value={option.id}>
                    {option.name} - {formatCurrency(option.priceCents, currency)}
                    {option.estimatedDays && ` (${option.estimatedDays} days)`}
                  </s-option>
                ))}
              </s-select>
            </s-box>
          </s-grid-item>
          <s-grid-item>
           <s-text>{formatCurrency(shippingCents, currency)}</s-text>
          </s-grid-item>
        </s-grid>

        {/* Tax */}
        <s-grid gridTemplateColumns="1fr auto" gap="base" alignItems="center">
          <s-stack direction="inline" gap="small-100" alignItems="center">
            <s-text>Estimated tax</s-text>
            {isCalculatingTax && <s-spinner size="base" />}
          </s-stack>
          <s-text>{formatCurrency(taxCents, currency)}</s-text>
        </s-grid>

        <s-divider />

        {/* Total */}
        <s-grid gridTemplateColumns="1fr auto" gap="base" alignItems="center">
          <s-heading>Total</s-heading>
          <s-heading>{formatCurrency(totalCents, currency)}</s-heading>
        </s-grid>
      </s-stack>
    </s-section>
  );
}

// Promotions Summary Section - shows all promotions applied to the order
function PromotionsSummarySection({
  lineItems,
  appliedPromotions,
  currency,
}: {
  lineItems: OrderLineItem[];
  appliedPromotions: OrderPromotion[];
  currency: string;
}) {
  // Extract line item promotions (free items) from line items
  const lineItemPromotions = lineItems
    .filter((item) => item.isFreeItem && item.promotionId)
    .reduce((acc, item) => {
      // Group by promotionId to avoid duplicates
      const existing = acc.find((p) => p.promotionId === item.promotionId);
      if (existing) {
        existing.totalValueCents += item.unitPriceCents * item.quantity;
      } else {
        acc.push({
          promotionId: item.promotionId!,
          promotionName: item.promotionName || "Promotion",
          totalValueCents: item.unitPriceCents * item.quantity,
        });
      }
      return acc;
    }, [] as Array<{ promotionId: string; promotionName: string; totalValueCents: number }>);

  // Order-level promotions (scope: ORDER_TOTAL)
  const orderLevelPromotions = appliedPromotions.filter(
    (p) => p.scope === "ORDER_TOTAL"
  );

  const hasPromotions = lineItemPromotions.length > 0 || orderLevelPromotions.length > 0;

  // Calculate total savings from all promotions
  const totalSavingsCents =
    lineItemPromotions.reduce((sum, p) => sum + p.totalValueCents, 0) +
    orderLevelPromotions.reduce((sum, p) => sum + p.discountCents, 0);

  if (!hasPromotions) {
    return null;
  }

  return (
    <s-section>
      <s-stack gap="base">
        <s-stack direction="inline" gap="base" justifyContent="space-between" alignItems="center">
          <s-heading>Promotions Applied</s-heading>
          {totalSavingsCents > 0 ? (
            <s-badge tone="success"><s-heading>Total Savings: {formatCurrency(totalSavingsCents, currency)}</s-heading></s-badge>
          ):(
            <s-badge tone="neutral">No Promotions</s-badge>
          )}
        </s-stack>
        <s-stack gap="small-200">
          {/* Line Item Promotions (Free Items) - compact single line */}
          {lineItemPromotions.map((promo) => (
            <s-box key={promo.promotionId} background="subdued" borderRadius="base" padding="small-200">
              <s-grid gridTemplateColumns="auto 1fr auto" gap="small-200" alignItems="center">
                <s-icon type="discount" />
                <s-text>{promo.promotionName}</s-text>
                <s-text> Savings: {formatCurrency(promo.totalValueCents, currency)}</s-text>
              </s-grid>
            </s-box>
          ))}

          {/* Order-Level Promotions - compact single line */}
          {orderLevelPromotions.map((promo) => (
            <s-box key={promo.id} background="subdued" borderRadius="base" padding="small-200">
              <s-grid gridTemplateColumns="auto 1fr auto" gap="small-200" alignItems="center">
                <s-icon type="discount" />
                <s-text>{promo.name}</s-text>
                <s-text>Savings: {formatCurrency(promo.discountCents, currency)}</s-text>
              </s-grid>
            </s-box>
          ))}
        </s-stack>
      </s-stack>
    </s-section>
  );
}

// Helper to format payment terms for display
function formatPaymentTerms(termsType?: string | null, termsDays?: number | null): string {
  if (!termsType) return "Due on Order";

  switch (termsType) {
    case "DUE_ON_RECEIPT":
      return "Due on Receipt";
    case "DUE_ON_FULFILLMENT":
      return "Due on Fulfillment";
    case "NET":
      return termsDays ? `Net ${termsDays}` : "Net Terms";
    default:
      // Handle NET_30, NET_60 format
      if (termsType.startsWith("NET_")) {
        const days = termsType.replace("NET_", "");
        return `Net ${days}`;
      }
      return termsType;
  }
}

// Convert Shopify payment terms type to our PaymentTerms enum
function toPaymentTermsEnum(termsType?: string | null): PaymentTerms {
  if (!termsType) return "DUE_ON_ORDER";

  switch (termsType) {
    case "DUE_ON_RECEIPT":
      return "DUE_ON_RECEIPT";
    case "DUE_ON_FULFILLMENT":
      return "DUE_ON_FULFILLMENT";
    case "NET_15":
      return "NET_15";
    case "NET_30":
    case "NET":
      return "NET_30";
    case "NET_45":
      return "NET_45";
    case "NET_60":
      return "NET_60";
    default:
      return "DUE_ON_ORDER";
  }
}

// Calculate payment due date based on terms
function calculateDueDate(termsType?: string | null, termsDays?: number | null): Date | null {
  // No due date for immediate payment or fulfillment-based terms
  if (!termsType || termsType === "DUE_ON_RECEIPT" || termsType === "DUE_ON_ORDER" || termsType === "DUE_ON_FULFILLMENT") {
    return null;
  }

  let days = termsDays;
  if (!days && termsType.startsWith("NET_")) {
    days = parseInt(termsType.replace("NET_", ""), 10);
  }

  if (days) {
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + days);
    return dueDate;
  }

  return null;
}

function PaymentSection({
  shippingLocation,
  contact,
  paymentTerms,
  selectedPaymentMethodId,
  onPaymentTermsChange,
  onPaymentMethodChange,
}: {
  shippingLocation: OrderLocation | null;
  contact: OrderContact | null;
  paymentTerms: PaymentTerms;
  selectedPaymentMethodId?: string | null;
  onPaymentTermsChange: (terms: PaymentTerms, dueDate: Date | null) => void;
  onPaymentMethodChange: (methodId: string | null) => void;
}) {
  const locationTerms = shippingLocation?.paymentTermsType;
  const locationDays = shippingLocation?.paymentTermsDays;
  const paymentMethods = contact?.paymentMethods || [];
  const hasVaultedCards = paymentMethods.length > 0;

  // Use refs to avoid re-running effects when only callback references change
  const onPaymentMethodChangeRef = useRef(onPaymentMethodChange);
  const onPaymentTermsChangeRef = useRef(onPaymentTermsChange);
  useEffect(() => {
    onPaymentMethodChangeRef.current = onPaymentMethodChange;
    onPaymentTermsChangeRef.current = onPaymentTermsChange;
  });

  // Auto-select default payment method if available
  useEffect(() => {
    if (hasVaultedCards && !selectedPaymentMethodId) {
      const defaultMethod = paymentMethods.find(m => m.isDefault) || paymentMethods[0];
      if (defaultMethod) {
        onPaymentMethodChangeRef.current(defaultMethod.id);
      }
    }
  }, [hasVaultedCards, paymentMethods, selectedPaymentMethodId]);

  // Track last location ID to only trigger on actual location changes
  const lastLocationIdRef = useRef<string | null>(null);

  // Update payment terms when location changes
  useEffect(() => {
    if (!shippingLocation) return;

    // Only update if location actually changed
    if (lastLocationIdRef.current === shippingLocation.id) return;
    lastLocationIdRef.current = shippingLocation.id;

    const terms = toPaymentTermsEnum(locationTerms);
    const dueDate = calculateDueDate(locationTerms, locationDays);
    onPaymentTermsChangeRef.current(terms, dueDate);
  }, [shippingLocation, locationTerms, locationDays]);

  return (
    <s-section heading="Payment">
      <s-stack gap="base">
        {/* Payment Terms from Location */}
        <s-box background="subdued" borderRadius="base" padding="base">
          <s-stack gap="small-200">
            <s-grid gridTemplateColumns="1fr auto" gap="small-200">
              <s-text type="strong">Payment Terms</s-text>
              <s-text>{formatPaymentTerms(locationTerms, locationDays)}</s-text>
            </s-grid>
            {locationTerms && locationTerms !== "DUE_ON_RECEIPT" && (
              <s-grid gridTemplateColumns="1fr auto" gap="small-200">
                <s-text color="subdued">Due Date</s-text>
                <s-text color="subdued">
                  {calculateDueDate(locationTerms, locationDays)?.toLocaleDateString() || "—"}
                </s-text>
              </s-grid>
            )}
            {shippingLocation?.checkoutToDraft && (
              <s-badge tone="warning">Requires Merchant Review</s-badge>
            )}
          </s-stack>
        </s-box>

        {/* Payment Method Selection */}
        {contact ? (
          hasVaultedCards ? (
            <s-stack gap="small-200">
              <s-text type="strong">Payment Method</s-text>
              <s-select
                label="Select payment method"
                labelAccessibilityVisibility="exclusive"
                value={selectedPaymentMethodId || ""}
                onChange={(e: Event) => {
                  const value = (e.target as HTMLSelectElement).value;
                  onPaymentMethodChange(value || null);
                }}
              >
                {paymentMethods.map((method) => (
                  <s-option key={method.id} value={method.id}>
                    {method.brand || method.provider} •••• {method.last4}
                    {method.expiryMonth && method.expiryYear && ` (${method.expiryMonth}/${method.expiryYear})`}
                    {method.isDefault && " (Default)"}
                  </s-option>
                ))}
                <s-option value="">Send Invoice Instead</s-option>
              </s-select>
              {!selectedPaymentMethodId && (
                <s-text color="subdued">
                  An invoice will be sent to {contact.email}
                </s-text>
              )}
            </s-stack>
          ) : (
            <s-box background="subdued" borderRadius="base" padding="base">
              <s-stack gap="small-200">
                <s-stack direction="inline" gap="small-200" alignItems="center">
                  <s-icon type="info" />
                  <s-text>No saved payment methods</s-text>
                </s-stack>
                <s-text color="subdued">
                  An invoice will be sent to {contact.email} when the order is placed
                  {paymentTerms !== "DUE_ON_ORDER" && " or when payment terms are due"}.
                </s-text>
              </s-stack>
            </s-box>
          )
        ) : (
          <s-text color="subdued">Select a billing contact to view payment options</s-text>
        )}
      </s-stack>
    </s-section>
  );
}

function OrderAttributesSection({
  poNumber,
  note,
  onPONumberChange,
  onNoteChange,
}: {
  poNumber: string;
  note: string;
  onPONumberChange: (poNumber: string) => void;
  onNoteChange: (note: string) => void;
}) {
  return (
    <s-section heading="Order Attributes">
      <s-stack gap="base">
        <s-text-field
          label="PO Number"
          value={poNumber}
          placeholder="Enter PO number"
          onInput={(e: Event) => onPONumberChange((e.target as HTMLInputElement).value)}
        />
        <s-text-area
          label="Notes"
          value={note}
          placeholder="Add order notes..."
          rows={3}
          onInput={(e: Event) => onNoteChange((e.target as HTMLTextAreaElement).value)}
        />
      </s-stack>
    </s-section>
  );
}

// Timeline Section
function TimelineSection({
  events,
  onAddComment,
}: {
  events: TimelineEvent[];
  onAddComment?: (comment: string) => void;
}) {
  const [newComment, setNewComment] = useState("");
  const [isAddingComment, setIsAddingComment] = useState(false);

  const handleAddComment = useCallback(() => {
    if (newComment.trim() && onAddComment) {
      onAddComment(newComment.trim());
      setNewComment("");
      setIsAddingComment(false);
    }
  }, [newComment, onAddComment]);

  // Format event message based on type
  const formatEventMessage = (event: TimelineEvent): string => {
    const metadata = event.metadata || {};

    switch (event.eventType) {
      case "draft_created":
        return "Order created as draft";
      case "submitted":
        return "Order submitted for approval";
      case "approved":
        return "Order approved";
      case "declined":
        return "Order declined";
      case "cancelled":
        return "Order cancelled";
      case "paid":
        return "Order marked as paid";
      case "refunded":
        return "Order refunded";
      case "comment":
        return "";
      case "company_changed":
        return `Changed company from "${metadata.oldValue || "none"}" to "${metadata.newValue}"`;
      case "contact_changed":
        return `Changed contact from "${metadata.oldValue || "none"}" to "${metadata.newValue}"`;
      case "shipping_location_changed":
        return `Changed shipping location from "${metadata.oldValue || "none"}" to "${metadata.newValue}"`;
      case "billing_location_changed":
        return `Changed billing location from "${metadata.oldValue || "none"}" to "${metadata.newValue}"`;
      case "po_number_changed":
        return `Changed PO number from "${metadata.oldValue || "none"}" to "${metadata.newValue}"`;
      case "note_changed":
        return "Updated order notes";
      case "shipping_method_changed":
        return `Changed shipping method from "${metadata.oldValue || "none"}" to "${metadata.newValue}"`;
      case "payment_terms_changed":
        return `Changed payment terms from "${metadata.oldValue || "none"}" to "${metadata.newValue}"`;
      case "line_item_added":
        return `Added ${metadata.quantity || 1}x ${metadata.productTitle}${metadata.variantTitle ? ` (${metadata.variantTitle})` : ""}`;
      case "line_item_removed":
        return `Removed ${metadata.quantity || 1}x ${metadata.productTitle}${metadata.variantTitle ? ` (${metadata.variantTitle})` : ""}`;
      case "line_item_quantity_changed":
        return `Changed quantity of ${metadata.productTitle}${metadata.variantTitle ? ` (${metadata.variantTitle})` : ""} from ${metadata.oldValue} to ${metadata.newValue}`;
      case "promotion_applied":
        return `Applied promotion: ${metadata.promotionName}`;
      case "promotion_removed":
        return `Removed promotion: ${metadata.promotionName}`;
      default:
        return event.eventType.replace(/_/g, " ");
    }
  };

  const formatDate = (dateStr: string): string => {
    const date = new Date(dateStr);
    return date.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  };

  const getEventIcon = (eventType: string): "note" | "check-circle" | "x-circle" | "product" | "discount" | "compose" | "chat" => {
    switch (eventType) {
      case "draft_created":
        return "note";
      case "submitted":
        return "note";
      case "approved":
        return "check-circle";
      case "declined":
        return "x-circle";
      case "cancelled":
        return "x-circle";
      case "paid":
        return "check-circle";
      case "refunded":
        return "x-circle";
      case "comment":
        return "chat";
      case "line_item_added":
      case "line_item_removed":
      case "line_item_quantity_changed":
        return "product";
      case "promotion_applied":
      case "promotion_removed":
        return "discount";
      default:
        return "compose";
    }
  };

  return (
    <s-box padding="base">
      <s-stack gap="base">
        <s-stack direction="inline" gap="base" justifyContent="space-between">
        <s-heading>Timeline</s-heading>
        <s-button variant="secondary" onClick={() => setIsAddingComment(true)}>
          Add Comment
        </s-button>
        </s-stack>
        {/* Add Comment Button/Form */}
        {onAddComment && (
          <s-box>
            {isAddingComment && (
              <s-stack gap="small-200">
                <s-text-area
                  label="Add a comment"
                  labelAccessibilityVisibility="exclusive"
                  value={newComment}
                  placeholder="Write a comment..."
                  rows={2}
                  onInput={(e: Event) => setNewComment((e.target as HTMLTextAreaElement).value)}
                />
                <s-stack direction="inline" gap="small-200">
                  <s-button variant="primary" onClick={handleAddComment} disabled={!newComment.trim()}>
                    Add Comment
                  </s-button>
                  <s-button variant="tertiary" onClick={() => { setIsAddingComment(false); setNewComment(""); }}>
                    Cancel
                  </s-button>
                </s-stack>
              </s-stack>
            )}
          </s-box>
        )}

        {/* Timeline Events */}
        {events.length > 0 ? (
          <s-stack gap="small-200">
            {events.slice().reverse().map((event) => (
              <s-box key={event.id} padding="small-200" background="subdued" borderRadius="base">
                <s-stack gap="small-100">
                  <s-stack direction="inline" gap="small-200" alignItems="center">
                    <s-icon type={getEventIcon(event.eventType)} />
                    <s-text type="strong">{event.authorName}</s-text>
                    <s-text color="subdued">•</s-text>
                    <s-text color="subdued">{formatDate(event.createdAt)}</s-text>
                  </s-stack>
                  <s-text>{formatEventMessage(event)}</s-text>
                  {event.comment && (
                    <s-box padding="small-200" borderRadius="base" background="base">
                      <s-text color="subdued">"{event.comment}"</s-text>
                    </s-box>
                  )}
                </s-stack>
              </s-box>
            ))}
          </s-stack>
        ) : (
          <s-text color="subdued">No timeline events yet.</s-text>
        )}
      </s-stack>
    </s-box>
  );
}

// Status badge helper
function getStatusBadge(status: string | undefined): { tone: "info" | "success" | "warning" | "critical"; label: string } {
  switch (status) {
    case "DRAFT":
      return { tone: "info", label: "Draft" };
    case "AWAITING_REVIEW":
      return { tone: "warning", label: "Awaiting Review" };
    case "PENDING":
      return { tone: "warning", label: "Pending Payment" };
    case "PAID":
      return { tone: "success", label: "Paid" };
    case "CANCELLED":
      return { tone: "critical", label: "Cancelled" };
    case "REFUNDED":
      return { tone: "critical", label: "Refunded" };
    default:
      return { tone: "info", label: status || "Unknown" };
  }
}

// Main OrderForm component
export function OrderForm({
  initialData,
  mode,
  onSave,
  onCancel,
  onSearchProducts,
  onLoadProducts,
  onLoadShippingOptions,
  initialShippingOptions,
  onLoadCompanies,
  onLoadContacts,
  onLoadLocations,
  onCalculateTax,
  onEvaluatePromotions,
  isSubmitting = false,
  onSubmitForApproval,
  onApprove,
  onDecline,
  onAddComment,
  shopDomain,
  readonly = false,
  timelineEvents = [],
  children,
}: OrderFormProps) {
  const SAVE_BAR_ID = "order-form-save-bar";
  const shopify = useAppBridge();

  // Store initial state for dirty checking
  const initialFormData = useRef<OrderFormData | null>(null);

  // Shipping options state - use initial options if provided
  const [shippingOptions, setShippingOptions] = useState<ShippingOption[]>(
    initialShippingOptions || []
  );

  // Comment state for action modals
  const [actionComment, setActionComment] = useState("");

  // Tax calculation state
  const [isCalculatingTax, setIsCalculatingTax] = useState(false);
  const taxCalculationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Promotion evaluation state
  const [isEvaluatingPromotions, setIsEvaluatingPromotions] = useState(false);
  const promotionEvaluationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Initialize with the initial line items key to prevent re-evaluation on mount
  const lastEvaluatedLineItemsRef = useRef<string | null>(
    (() => {
      const regularItems = (initialData?.lineItems || []).filter(li => !li.isFreeItem);
      if (regularItems.length === 0) return null;
      return JSON.stringify(
        regularItems.map(li => ({
          variantId: li.shopifyVariantId,
          qty: li.quantity,
        }))
      );
    })()
  );

  // Load shipping options on mount ONLY if not provided initially (with cleanup for unmount)
  useEffect(() => {
    // Skip async loading if we already have initial options
    if (initialShippingOptions && initialShippingOptions.length > 0) return;
    if (!onLoadShippingOptions) return;

    let cancelled = false;
    onLoadShippingOptions().then((options) => {
      if (!cancelled) {
        setShippingOptions(options);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [onLoadShippingOptions, initialShippingOptions]);

  // Initialize state from initialData
  const [formData, setFormData] = useState<OrderFormData>(() => {
    const data: OrderFormData = {
      id: initialData?.id,
      orderNumber: initialData?.orderNumber,
      status: initialData?.status || "DRAFT",
      company: initialData?.company || null,
      contact: initialData?.contact || null,
      salesRepName: initialData?.salesRepName,
      shippingLocation: initialData?.shippingLocation || null,
      billingLocation: initialData?.billingLocation || null,
      lineItems: initialData?.lineItems || [],
      appliedPromotions: initialData?.appliedPromotions || [],
      selectedShippingOption: initialData?.selectedShippingOption || null,
      note: initialData?.note || "",
      poNumber: initialData?.poNumber || "",
      paymentTerms: initialData?.paymentTerms || "DUE_ON_ORDER",
      paymentMethodId: initialData?.paymentMethodId || null,
      paymentDueDate: initialData?.paymentDueDate || null,
      subtotalCents: initialData?.subtotalCents || 0,
      discountCents: initialData?.discountCents || 0,
      shippingCents: initialData?.shippingCents || 0,
      taxCents: initialData?.taxCents || 0,
      taxLines: initialData?.taxLines || [],
      totalCents: initialData?.totalCents || 0,
      currency: initialData?.currency || "USD",
    };
    initialFormData.current = JSON.parse(JSON.stringify(data));
    return data;
  });

  // Track last synced initialData to avoid unnecessary updates
  const lastSyncedDataRef = useRef<string | null>(null);

  // Sync form data when initialData changes (e.g., after save and revalidation)
  // Uses serialized comparison to avoid triggering on object reference changes
  useEffect(() => {
    if (!initialData) return;

    // Create a stable key from the data to detect actual changes
    const dataKey = JSON.stringify({
      id: initialData.id,
      lineItems: initialData.lineItems?.length,
      subtotalCents: initialData.subtotalCents,
      discountCents: initialData.discountCents,
      shippingCents: initialData.shippingCents,
      selectedShippingOptionId: initialData.selectedShippingOption?.id,
      totalCents: initialData.totalCents,
      status: initialData.status,
    });

    // Skip if this exact data was already synced
    if (lastSyncedDataRef.current === dataKey) return;
    lastSyncedDataRef.current = dataKey;

    const newData: OrderFormData = {
      id: initialData.id,
      orderNumber: initialData.orderNumber,
      status: initialData.status || "DRAFT",
      shopifyDraftOrderId: initialData.shopifyDraftOrderId,
      shopifyOrderId: initialData.shopifyOrderId,
      shopifyOrderNumber: initialData.shopifyOrderNumber,
      company: initialData.company || null,
      contact: initialData.contact || null,
      salesRepName: initialData.salesRepName,
      shippingLocation: initialData.shippingLocation || null,
      billingLocation: initialData.billingLocation || null,
      lineItems: initialData.lineItems || [],
      appliedPromotions: initialData.appliedPromotions || [],
      selectedShippingOption: initialData.selectedShippingOption || null,
      note: initialData.note || "",
      poNumber: initialData.poNumber || "",
      paymentTerms: initialData.paymentTerms || "DUE_ON_ORDER",
      paymentMethodId: initialData.paymentMethodId || null,
      paymentDueDate: initialData.paymentDueDate || null,
      subtotalCents: initialData.subtotalCents || 0,
      discountCents: initialData.discountCents || 0,
      shippingCents: initialData.shippingCents || 0,
      taxCents: initialData.taxCents || 0,
      taxLines: initialData.taxLines || [],
      totalCents: initialData.totalCents || 0,
      currency: initialData.currency || "USD",
    };
    setFormData(newData);
    initialFormData.current = JSON.parse(JSON.stringify(newData));

    // Also update the lastEvaluatedLineItemsRef to prevent re-evaluation after sync
    const regularItems = (initialData.lineItems || []).filter(li => !li.isFreeItem);
    if (regularItems.length > 0) {
      lastEvaluatedLineItemsRef.current = JSON.stringify(
        regularItems.map(li => ({
          variantId: li.shopifyVariantId,
          qty: li.quantity,
        }))
      );
    }
  }, [initialData]);

  // Extract only user-editable fields for dirty comparison
  // Excludes auto-calculated fields: taxCents, totalCents, subtotalCents, discountCents, appliedPromotions, taxLines
  const getEditableState = useCallback((data: OrderFormData) => {
    // Only include non-free line items with relevant fields
    const editableLineItems = data.lineItems
      .filter((item) => !item.isFreeItem)
      .map((item) => ({
        shopifyVariantId: item.shopifyVariantId,
        quantity: item.quantity,
      }));

    return {
      company: data.company?.id || null,
      contact: data.contact?.id || null,
      shippingLocation: data.shippingLocation?.id || null,
      billingLocation: data.billingLocation?.id || null,
      lineItems: editableLineItems,
      selectedShippingOption: data.selectedShippingOption?.id || null,
      note: data.note,
      poNumber: data.poNumber,
      paymentTerms: data.paymentTerms,
      paymentMethodId: data.paymentMethodId || null,
    };
  }, []);

  // Check if form has unsaved changes (only comparing user-editable fields)
  const isDirty = useMemo(() => {
    if (!initialFormData.current) return false;
    const currentEditable = getEditableState(formData);
    const initialEditable = getEditableState(initialFormData.current);
    return JSON.stringify(currentEditable) !== JSON.stringify(initialEditable);
  }, [formData, getEditableState]);

  // Show/hide save bar based on dirty state
  useEffect(() => {
    if (isDirty) {
      shopify.saveBar.show(SAVE_BAR_ID);
    } else {
      shopify.saveBar.hide(SAVE_BAR_ID);
    }
  }, [isDirty, shopify]);

  // Hide save bar on unmount
  useEffect(() => {
    return () => {
      saveBar.hide(SAVE_BAR_ID);
    };
  }, []);

  // Discard handler - reset to initial state
  const handleDiscard = useCallback(() => {
    if (initialFormData.current) {
      setFormData(JSON.parse(JSON.stringify(initialFormData.current)));
    }
    onCancel();
  }, [onCancel]);

  // Calculate tax when conditions change (debounced)
  const calculateTax = useCallback(async () => {
    if (!onCalculateTax) return;

    // Need line items and shipping address to calculate tax
    const regularLineItems = formData.lineItems.filter(li => !li.isFreeItem);
    if (regularLineItems.length === 0) return;
    if (!formData.shippingLocation) return;

    setIsCalculatingTax(true);

    try {
      const result = await onCalculateTax({
        lineItems: regularLineItems.map(li => ({
          shopifyVariantId: li.shopifyVariantId,
          title: li.title,
          quantity: li.quantity,
          unitPriceCents: li.unitPriceCents,
        })),
        shippingAddress: {
          address1: formData.shippingLocation.address1,
          city: formData.shippingLocation.city,
          province: formData.shippingLocation.provinceCode || formData.shippingLocation.province,
          zip: formData.shippingLocation.zipcode,
          countryCode: formData.shippingLocation.country === "United States" ? "US" : formData.shippingLocation.country,
        },
        shippingCents: formData.shippingCents,
      });

      setFormData(prev => ({
        ...prev,
        taxCents: result.taxCents,
        taxLines: result.taxLines,
        totalCents: prev.subtotalCents - prev.discountCents + prev.shippingCents + result.taxCents,
      }));
    } catch (error) {
      console.error("Failed to calculate tax:", error);
    } finally {
      setIsCalculatingTax(false);
    }
  }, [onCalculateTax, formData.lineItems, formData.shippingLocation, formData.shippingCents]);

  // Trigger tax calculation when shipping address or line items change (debounced)
  useEffect(() => {
    if (!onCalculateTax) return;
    if (!formData.shippingLocation) return;
    if (formData.lineItems.filter(li => !li.isFreeItem).length === 0) return;

    // Clear any pending calculation
    if (taxCalculationTimeoutRef.current) {
      clearTimeout(taxCalculationTimeoutRef.current);
    }

    // Debounce tax calculation by 500ms
    taxCalculationTimeoutRef.current = setTimeout(() => {
      calculateTax();
    }, 500);

    return () => {
      if (taxCalculationTimeoutRef.current) {
        clearTimeout(taxCalculationTimeoutRef.current);
      }
    };
  }, [
    formData.shippingLocation?.id,
    formData.lineItems.length,
    formData.shippingCents,
    calculateTax,
  ]);

  // Evaluate promotions when line items change
  const evaluatePromotions = useCallback(async () => {
    if (!onEvaluatePromotions) return;

    // Get regular (non-promotion) line items for evaluation
    const regularLineItems = formData.lineItems.filter(li => !li.isFreeItem);
    if (regularLineItems.length === 0) {
      // Clear promotions if no items
      setFormData(prev => ({
        ...prev,
        appliedPromotions: [],
        discountCents: 0,
        // Remove any existing free items
        lineItems: prev.lineItems.filter(li => !li.isFreeItem),
        totalCents: prev.subtotalCents + prev.shippingCents + prev.taxCents,
      }));
      return;
    }

    // Create a key for comparison to avoid duplicate evaluations
    const itemsKey = JSON.stringify(
      regularLineItems.map(li => ({
        variantId: li.shopifyVariantId,
        qty: li.quantity,
      }))
    );

    // Skip if we've already evaluated this exact set of items
    if (lastEvaluatedLineItemsRef.current === itemsKey) return;

    setIsEvaluatingPromotions(true);

    try {
      const result = await onEvaluatePromotions({
        lineItems: regularLineItems.map(li => ({
          id: li.id,
          shopifyProductId: li.shopifyProductId,
          shopifyVariantId: li.shopifyVariantId,
          title: li.title,
          variantTitle: li.variantTitle,
          sku: li.sku,
          quantity: li.quantity,
          unitPriceCents: li.unitPriceCents,
          isFreeItem: false,
        })),
      });

      // Update last evaluated key
      lastEvaluatedLineItemsRef.current = itemsKey;

      // Remove existing promotion items and add new ones
      const nonPromotionItems = formData.lineItems.filter(li => !li.isFreeItem);

      // Create new free items from result
      const newFreeItems: OrderLineItem[] = result.freeItemsToAdd.map((item, index) => ({
        id: `free_${item.promotionId}_${item.variantId}_${index}`,
        shopifyProductId: item.productId,
        shopifyVariantId: item.variantId,
        sku: item.sku || null,
        title: item.title,
        variantTitle: item.variantTitle || null,
        quantity: item.quantity,
        unitPriceCents: item.unitPriceCents,
        discountCents: item.unitPriceCents * item.quantity, // Full discount
        totalCents: 0, // Free item
        isFreeItem: true,
        promotionId: item.promotionId,
        promotionName: item.promotionName,
      }));

      // Map applied promotions
      const appliedPromotions: OrderPromotion[] = result.appliedPromotions.map(p => ({
        id: p.id,
        name: p.name,
        type: p.type as PromotionType,
        scope: p.scope as PromotionScope,
        value: 0, // Not needed for display
        discountCents: p.discountCents,
      }));

      // Calculate order-level discount (only ORDER_TOTAL scope promotions)
      const orderLevelDiscountCents = result.appliedPromotions
        .filter(p => p.scope === "ORDER_TOTAL")
        .reduce((sum, p) => sum + p.discountCents, 0);

      setFormData(prev => {
        const allLineItems = [...nonPromotionItems, ...newFreeItems];
        const subtotalCents = nonPromotionItems.reduce((sum, item) => sum + item.totalCents, 0);
        const totalCents = Math.max(0, subtotalCents - orderLevelDiscountCents + prev.shippingCents + prev.taxCents);

        return {
          ...prev,
          lineItems: allLineItems,
          appliedPromotions,
          discountCents: orderLevelDiscountCents,
          subtotalCents,
          totalCents,
        };
      });
    } catch (error) {
      console.error("Failed to evaluate promotions:", error);
    } finally {
      setIsEvaluatingPromotions(false);
    }
  }, [onEvaluatePromotions, formData.lineItems]);

  // Trigger promotion evaluation when line items change (debounced)
  useEffect(() => {
    if (!onEvaluatePromotions) return;

    const regularLineItems = formData.lineItems.filter(li => !li.isFreeItem);
    if (regularLineItems.length === 0) {
      // Clear promotions immediately if no items
      lastEvaluatedLineItemsRef.current = null;
      setFormData(prev => {
        if (prev.appliedPromotions.length === 0 && prev.discountCents === 0) {
          return prev; // No change needed
        }
        return {
          ...prev,
          appliedPromotions: [],
          discountCents: 0,
          lineItems: prev.lineItems.filter(li => !li.isFreeItem),
          totalCents: prev.subtotalCents + prev.shippingCents + prev.taxCents,
        };
      });
      return;
    }

    // Create a key for comparison
    const itemsKey = JSON.stringify(
      regularLineItems.map(li => ({
        variantId: li.shopifyVariantId,
        qty: li.quantity,
      }))
    );

    // Skip if we've already evaluated this exact set of items
    if (lastEvaluatedLineItemsRef.current === itemsKey) return;

    // Clear any pending evaluation
    if (promotionEvaluationTimeoutRef.current) {
      clearTimeout(promotionEvaluationTimeoutRef.current);
    }

    // Debounce promotion evaluation by 300ms
    promotionEvaluationTimeoutRef.current = setTimeout(() => {
      evaluatePromotions();
    }, 300);

    return () => {
      if (promotionEvaluationTimeoutRef.current) {
        clearTimeout(promotionEvaluationTimeoutRef.current);
      }
    };
  }, [formData.lineItems, onEvaluatePromotions, evaluatePromotions]);

  // Recalculate totals for local display (promotion items are handled server-side)
  // Uses functional update to avoid stale closure issues
  const recalculateTotals = useCallback((
    lineItems: OrderLineItem[],
    shippingOption?: ShippingOption | null
  ) => {
    setFormData((prev) => {
      // Calculate subtotal from regular (non-promotion) items only
      const regularItems = lineItems.filter(item => !item.isFreeItem);
      const subtotalCents = regularItems.reduce((sum, item) => sum + item.totalCents, 0);

      // Use provided shipping option or keep existing from prev state (not closure)
      const selectedShippingOption = shippingOption !== undefined ? shippingOption : prev.selectedShippingOption;

      // Get shipping cost
      const shippingCents = selectedShippingOption?.priceCents || 0;

      // Keep existing tax and discount from prev state (will be recalculated on server)
      const taxCents = prev.taxCents;
      const discountCents = prev.discountCents;

      // Calculate total
      const totalCents = Math.max(0, subtotalCents - discountCents + shippingCents + taxCents);

      return {
        ...prev,
        lineItems, // Keep ALL items including promotions - don't filter
        selectedShippingOption,
        subtotalCents,
        shippingCents,
        taxCents,
        totalCents,
      };
    });
  }, []); // No dependencies needed - uses functional update

  // Shipping handler
  const handleSelectShipping = useCallback((option: ShippingOption | null) => {
    recalculateTotals(formData.lineItems, option);
  }, [formData.lineItems, recalculateTotals]);

  // Line item handlers
  const handleUpdateQuantity = useCallback((itemId: string, quantity: number) => {
    // Find the item to check if it's a free item
    const itemToUpdate = formData.lineItems.find((item) => item.id === itemId);

    // Don't allow quantity changes on promotion items (controlled by server)
    if (itemToUpdate?.isFreeItem) {
      return;
    }

    const updatedItems = formData.lineItems.map((item) => {
      if (item.id === itemId) {
        return {
          ...item,
          quantity,
          totalCents: item.unitPriceCents * quantity - item.discountCents,
        };
      }
      return item;
    });
    recalculateTotals(updatedItems);
  }, [formData.lineItems, recalculateTotals]);

  const handleRemoveItem = useCallback((itemId: string) => {
    // Filter out the removed item (both regular and promotion items can be removed)
    const updatedItems = formData.lineItems.filter((item) => item.id !== itemId);
    recalculateTotals(updatedItems);
  }, [formData.lineItems, recalculateTotals]);

  // Add products to the order
  const handleAddProducts = useCallback((products: ProductSearchResult[]) => {
    // Keep all existing items including promotions
    let updatedItems = [...formData.lineItems];

    for (const product of products) {
      // Only look for existing regular items (not promotion items) to increment
      const existingIndex = updatedItems.findIndex(
        (item) => item.shopifyVariantId === product.shopifyVariantId && !item.isFreeItem
      );

      if (existingIndex >= 0) {
        // Increment quantity if already exists
        const existing = updatedItems[existingIndex];
        updatedItems[existingIndex] = {
          ...existing,
          quantity: existing.quantity + 1,
          totalCents: existing.unitPriceCents * (existing.quantity + 1) - existing.discountCents,
        };
      } else {
        // Add new item
        updatedItems.push({
          id: generateTempId(),
          shopifyProductId: product.shopifyProductId,
          shopifyVariantId: product.shopifyVariantId,
          sku: product.sku,
          title: product.title,
          variantTitle: product.variantTitle,
          imageUrl: product.imageUrl,
          quantity: 1,
          unitPriceCents: product.priceCents,
          discountCents: 0,
          totalCents: product.priceCents,
        });
      }
    }

    recalculateTotals(updatedItems);
  }, [formData.lineItems, recalculateTotals]);

  // Form field handlers
  const handleNoteChange = useCallback((note: string) => {
    setFormData((prev) => ({ ...prev, note }));
  }, []);

  const handlePONumberChange = useCallback((poNumber: string) => {
    setFormData((prev) => ({ ...prev, poNumber }));
  }, []);

  const handlePaymentTermsChange = useCallback((paymentTerms: PaymentTerms, paymentDueDate: Date | null) => {
    setFormData((prev) => ({ ...prev, paymentTerms, paymentDueDate }));
  }, []);

  const handlePaymentMethodChange = useCallback((paymentMethodId: string | null) => {
    setFormData((prev) => ({ ...prev, paymentMethodId }));
  }, []);

  // Company/Contact/Location handlers
  const handleCompanySelect = useCallback((company: OrderCompany | null) => {
    setFormData((prev) => ({ ...prev, company }));
  }, []);

  const handleContactSelect = useCallback((contact: OrderContact | null) => {
    setFormData((prev) => ({ ...prev, contact }));
  }, []);

  const handleShippingLocationSelect = useCallback((shippingLocation: OrderLocation | null) => {
    setFormData((prev) => ({ ...prev, shippingLocation }));
  }, []);

  const handleCompanySuccess = useCallback((companies: Company[]) => {
    if (companies.length > 0) {
      shopify.toast.show(`Selected ${companies[0].name}`);
    }
  }, [shopify]);

  // Submit handler
  const handleSubmit = useCallback(() => {
    onSave(formData);
  }, [formData, onSave]);

  // Action modal handlers
  const handleSubmitForApproval = useCallback(() => {
    if (onSubmitForApproval) {
      onSubmitForApproval(actionComment || undefined);
      setActionComment("");
    }
  }, [onSubmitForApproval, actionComment]);

  const handleApprove = useCallback(() => {
    if (onApprove) {
      onApprove(actionComment || undefined);
      setActionComment("");
    }
  }, [onApprove, actionComment]);

  const handleDecline = useCallback(() => {
    if (onDecline) {
      onDecline(actionComment || undefined);
      setActionComment("");
    }
  }, [onDecline, actionComment]);

  const pageHeading = mode === "create"
    ? "New Order"
    : formData.orderNumber
      ? `#${formData.orderNumber}`
      : "Edit Order";

  return (
    <>
      <ui-save-bar id={SAVE_BAR_ID}>
        <button
          variant="primary"
          onClick={handleSubmit}
          disabled={isSubmitting || formData.lineItems.length === 0}
        >
          {isSubmitting ? "Saving..." : "Save"}
        </button>
        <button onClick={handleDiscard}>Discard</button>
      </ui-save-bar>

      {/* Submit for Approval Modal */}
      <Modal
        id="submit-modal"
        heading="Submit for Approval"
        onClose={() => setActionComment("")}
        primaryAction={{
          content: isSubmitting ? "Submitting..." : "Submit for Approval",
          onAction: handleSubmitForApproval,
          loading: isSubmitting,
        }}
        secondaryActions={[
          { content: "Cancel" },
        ]}
      >
        <s-stack gap="base">
          <s-text>This order will be submitted for manager approval.</s-text>
          <s-text-area
            label="Comment (optional)"
            value={actionComment}
            placeholder="Add any notes for the reviewer..."
            rows={3}
            onInput={(e: Event) => setActionComment((e.target as HTMLTextAreaElement).value)}
          />
        </s-stack>
      </Modal>

      {/* Approve Order Modal */}
      <Modal
        id="approve-modal"
        heading="Approve Order"
        onClose={() => setActionComment("")}
        primaryAction={{
          content: isSubmitting ? "Approving..." : "Approve Order",
          onAction: handleApprove,
          loading: isSubmitting,
        }}
        secondaryActions={[
          { content: "Cancel", variant: "secondary" },
        ]}
      >
        <s-stack gap="base">
          <s-text>This order will be approved and submitted to Shopify for processing.</s-text>
          <s-text-area
            label="Comment (optional)"
            value={actionComment}
            placeholder="Add any additional comments with submission..."
            rows={3}
            onInput={(e: Event) => setActionComment((e.target as HTMLTextAreaElement).value)}
          />
        </s-stack>
      </Modal>

      {/* Decline Order Modal */}
      <Modal
        id="decline-modal"
        heading="Decline Order"
        onClose={() => setActionComment("")}
        primaryAction={{
          content: "Decline Order",
          onAction: handleDecline,
          loading: isSubmitting,
          tone: "critical",
        }}
        secondaryActions={[
          { content: "Cancel", variant: "secondary" },
        ]}
      >
        <s-stack gap="base">
          <s-text>This order will be declined and returned to draft status.</s-text>
          <s-text-area
            label="Reason for declining"
            value={actionComment}
            placeholder="Please state why this order is being declined..."
            rows={3}
            onInput={(e: Event) => setActionComment((e.target as HTMLTextAreaElement).value)}
          />
        </s-stack>
      </Modal>

      <s-page heading={pageHeading}>
        <s-link slot="breadcrumb-actions" href="/app/orders">
          Orders
        </s-link>

        <s-grid gridTemplateColumns="2fr 1fr" gap="base">
        {/* Main content */}
        <s-stack gap="base">
          <CompanySection
            company={formData.company}
            contact={formData.contact}
            shippingLocation={formData.shippingLocation}
            onCompanySelect={handleCompanySelect}
            onContactSelect={handleContactSelect}
            onShippingLocationSelect={handleShippingLocationSelect}
            onLoadCompanies={onLoadCompanies}
            onLoadContacts={onLoadContacts}
            onLoadLocations={onLoadLocations}
            onCompanySuccess={handleCompanySuccess}
            readonly={readonly}
          />

          <ProductsSection
            lineItems={formData.lineItems}
            currency={formData.currency}
            onUpdateQuantity={handleUpdateQuantity}
            onRemoveItem={handleRemoveItem}
            onSearchProducts={onSearchProducts}
            onLoadProducts={onLoadProducts}
            onAddProducts={handleAddProducts}
            readonly={readonly}
          />

          <OrderSummarySection
            lineItems={formData.lineItems}
            subtotalCents={formData.subtotalCents}
            discountCents={formData.discountCents}
            selectedShippingOption={formData.selectedShippingOption}
            shippingCents={formData.shippingCents}
            taxCents={formData.taxCents}
            totalCents={formData.totalCents}
            currency={formData.currency}
            shippingOptions={shippingOptions}
            onSelectShipping={handleSelectShipping}
            isCalculatingTax={isCalculatingTax}
          />

          <PromotionsSummarySection
            lineItems={formData.lineItems}
            appliedPromotions={formData.appliedPromotions}
            currency={formData.currency}
          />

          <PaymentSection
            shippingLocation={formData.shippingLocation}
            contact={formData.contact}
            paymentTerms={formData.paymentTerms}
            selectedPaymentMethodId={formData.paymentMethodId}
            onPaymentTermsChange={handlePaymentTermsChange}
            onPaymentMethodChange={handlePaymentMethodChange}
          />

          {/* Timeline - shown in edit mode */}
          {mode === "edit" && (
            <TimelineSection
              events={timelineEvents}
              onAddComment={onAddComment}
            />
          )}
        </s-stack>

        {/* Sidebar */}
        <s-stack gap="base">

          {mode === "edit" && formData.status && (
          <s-section>
            <s-stack gap="base">
              <s-stack direction="inline" gap="base">
                <s-heading>Order Status</s-heading>
                <s-badge tone={getStatusBadge(formData.status).tone}>
                  {getStatusBadge(formData.status).label}
                </s-badge>
              </s-stack>

              {/* Submit for Approval - DRAFT orders */}
              {formData.status === "DRAFT" && onSubmitForApproval && !formData.shopifyOrderId && (
                <ModalTrigger
                  modalId="submit-modal"
                  variant="primary"
                  disabled={isSubmitting || formData.lineItems.length === 0}
                >
                  {isSubmitting ? "Submitting..." : "Submit for Approval"}
                </ModalTrigger>
              )}

              {/* Approve/Decline Order - AWAITING_REVIEW orders */}
              {formData.status === "AWAITING_REVIEW" && !formData.shopifyOrderId && (
                <s-stack direction="inline" gap="small-200">
                  {onApprove && (
                    <ModalTrigger
                      modalId="approve-modal"
                      variant="primary"
                      disabled={isSubmitting || formData.lineItems.length === 0}
                    >
                      {isSubmitting ? "Approving..." : "Approve Order"}
                    </ModalTrigger>
                  )}
                  {onDecline && (
                    <ModalTrigger
                      modalId="decline-modal"
                      variant="tertiary"
                      tone="critical"
                      disabled={isSubmitting}
                    >
                      Decline Order
                    </ModalTrigger>
                  )}
                </s-stack>
              )}

              {/* Show Shopify link when order is submitted */}
              {formData.shopifyOrderId && shopDomain && (
                <s-button
                  href={`https://${shopDomain}/admin/orders/${formData.shopifyOrderId}`}
                  target="_blank"
                  icon={"external"}
                >
                  View in Shopify
                </s-button>
              )}
            </s-stack>
          </s-section>
          )}

          <OrderAttributesSection
            poNumber={formData.poNumber}
            note={formData.note}
            onPONumberChange={handlePONumberChange}
            onNoteChange={handleNoteChange}
          />

          {/* Additional content (e.g., Shopify integration, order actions) */}
          <s-box>{children}</s-box>

        </s-stack>
      </s-grid>
    </s-page>
    </>
  );
}

export default OrderForm;
