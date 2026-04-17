'use client';

/**
 * useOrderForm Hook
 *
 * Web-specific version with local type definitions.
 * Uses the same logic pattern as the shared hook but with platform-specific types.
 */

import { useState, useRef, useCallback, useMemo } from 'react';
import type { OrderStatus, PaymentTerms } from '@field-sales/database';
import type { CompanyOption } from '@/components/pickers/CompanyPicker';
import type { ContactOption } from '@/components/pickers/ContactPicker';
import type { LocationOption } from '@/components/pickers/LocationPicker';

// Price break for volume pricing
export interface PriceBreak {
  minimumQuantity: number;
  priceCents: number;
}

// Line item type
export interface OrderLineItem {
  id: string;
  shopifyProductId: string;
  shopifyVariantId: string;
  sku: string | null;
  title: string;
  variantTitle: string | null;
  imageUrl: string | null;
  quantity: number;
  unitPriceCents: number;    // Current price (may change with volume pricing)
  basePriceCents: number;    // Base price before volume pricing
  discountCents: number;
  totalCents: number;
  isFreeItem?: boolean;
  promotionId?: string;
  promotionName?: string;
  // Quantity rules from B2B catalog
  quantityMin: number | null;
  quantityMax: number | null;
  quantityIncrement: number | null;
  priceBreaks: PriceBreak[];
}

/**
 * Calculate the effective unit price based on quantity and price breaks
 */
export function getEffectiveUnitPrice(
  basePriceCents: number,
  quantity: number,
  priceBreaks: PriceBreak[]
): number {
  if (priceBreaks.length === 0) return basePriceCents;

  // Sort by minimumQuantity descending to find the highest applicable tier
  const sortedBreaks = [...priceBreaks].sort((a, b) => b.minimumQuantity - a.minimumQuantity);

  for (const tier of sortedBreaks) {
    if (quantity >= tier.minimumQuantity) {
      return tier.priceCents;
    }
  }

  return basePriceCents;
}

/**
 * Validate and adjust quantity to meet rules
 */
export function validateQuantity(
  requestedQuantity: number,
  min: number | null,
  max: number | null,
  increment: number | null
): number {
  let quantity = requestedQuantity;

  // Apply minimum
  const effectiveMin = min ?? 1;
  if (quantity < effectiveMin) {
    quantity = effectiveMin;
  }

  // Apply maximum
  if (max !== null && quantity > max) {
    quantity = max;
  }

  // Apply increment (snap to nearest valid value)
  if (increment && increment > 1) {
    const remainder = (quantity - effectiveMin) % increment;
    if (remainder !== 0) {
      // Round up to next valid increment
      quantity = quantity - remainder + increment;
      // Re-check max after snapping
      if (max !== null && quantity > max) {
        quantity = quantity - increment;
      }
    }
  }

  return Math.max(effectiveMin, quantity);
}

// Promotion result from engine
export interface AppliedPromotion {
  id: string;
  name: string;
  type: string;
  scope: 'LINE_ITEM' | 'ORDER_TOTAL' | 'SHIPPING';
  discountCents: number;
}

// Shipping option
export interface ShippingOption {
  id: string;
  title: string;
  priceCents: number;
}

// Timeline event
export interface TimelineEvent {
  id: string;
  authorType: 'SALES_REP' | 'ADMIN' | 'SYSTEM';
  authorId: string | null;
  authorName: string;
  eventType: string;
  metadata: Record<string, unknown> | null;
  comment: string | null;
  createdAt: string;
}

// Full order form data
export interface OrderFormData {
  id?: string;
  orderNumber?: string;
  status: OrderStatus;
  shopifyOrderId?: string | null;
  company: CompanyOption | null;
  contact: ContactOption | null;
  shippingLocation: LocationOption | null;
  billingLocation: LocationOption | null;
  lineItems: OrderLineItem[];
  appliedPromotions: AppliedPromotion[];
  selectedShippingOption: ShippingOption | null;
  note: string;
  poNumber: string;
  paymentTerms: PaymentTerms;
  subtotalCents: number;
  discountCents: number;
  shippingCents: number;
  taxCents: number;
  totalCents: number;
  currency: string;
  timelineEvents: TimelineEvent[];
}

// Initial data for editing
export interface InitialOrderData {
  id?: string;
  orderNumber?: string;
  status?: OrderStatus;
  shopifyOrderId?: string | null;
  company?: CompanyOption | null;
  contact?: ContactOption | null;
  shippingLocation?: LocationOption | null;
  billingLocation?: LocationOption | null;
  lineItems?: OrderLineItem[];
  appliedPromotions?: AppliedPromotion[];
  selectedShippingOption?: ShippingOption | null;
  note?: string;
  poNumber?: string;
  paymentTerms?: PaymentTerms;
  subtotalCents?: number;
  discountCents?: number;
  shippingCents?: number;
  taxCents?: number;
  totalCents?: number;
  currency?: string;
  timelineEvents?: TimelineEvent[];
}

const DEFAULT_FORM_DATA: OrderFormData = {
  status: 'DRAFT',
  shopifyOrderId: null,
  company: null,
  contact: null,
  shippingLocation: null,
  billingLocation: null,
  lineItems: [],
  appliedPromotions: [],
  selectedShippingOption: null,
  note: '',
  poNumber: '',
  paymentTerms: 'DUE_ON_ORDER',
  subtotalCents: 0,
  discountCents: 0,
  shippingCents: 0,
  taxCents: 0,
  totalCents: 0,
  currency: 'USD',
  timelineEvents: [],
};

function generateTempId(): string {
  return `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

export function useOrderForm(initialData?: InitialOrderData) {
  // Build initial form data
  const buildFormData = useCallback((): OrderFormData => {
    return {
      ...DEFAULT_FORM_DATA,
      ...initialData,
      lineItems: initialData?.lineItems || [],
      appliedPromotions: initialData?.appliedPromotions || [],
      timelineEvents: initialData?.timelineEvents || [],
    };
  }, [initialData]);

  // Store initial state for dirty checking
  const initialRef = useRef<OrderFormData | null>(null);

  // Form state
  const [formData, setFormData] = useState<OrderFormData>(() => {
    const data = buildFormData();
    initialRef.current = JSON.parse(JSON.stringify(data));
    return data;
  });

  // Extract only user-editable fields for dirty comparison
  const getUserEditableState = useCallback((data: OrderFormData) => {
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
    };
  }, []);

  // Check if form is dirty
  const isDirty = useMemo(() => {
    if (!initialRef.current) return false;
    const currentEditable = getUserEditableState(formData);
    const initialEditable = getUserEditableState(initialRef.current);
    return JSON.stringify(currentEditable) !== JSON.stringify(initialEditable);
  }, [formData, getUserEditableState]);

  // Reset to initial state
  const resetForm = useCallback(() => {
    if (initialRef.current) {
      setFormData(JSON.parse(JSON.stringify(initialRef.current)));
    }
  }, []);

  // Update initial reference (after save)
  const updateInitialRef = useCallback(() => {
    initialRef.current = JSON.parse(JSON.stringify(formData));
  }, [formData]);

  // Company handlers
  const setCompany = useCallback((company: CompanyOption | null) => {
    setFormData((prev) => ({
      ...prev,
      company,
      contact: null,
      shippingLocation: null,
      billingLocation: null,
    }));
  }, []);

  // Contact handlers
  const setContact = useCallback((contact: ContactOption | null) => {
    setFormData((prev) => ({ ...prev, contact }));
  }, []);

  // Location handlers
  const setShippingLocation = useCallback((shippingLocation: LocationOption | null) => {
    setFormData((prev) => ({ ...prev, shippingLocation }));
  }, []);

  const setBillingLocation = useCallback((billingLocation: LocationOption | null) => {
    setFormData((prev) => ({ ...prev, billingLocation }));
  }, []);

  // Line item handlers
  const addLineItem = useCallback((item: Omit<OrderLineItem, 'id' | 'discountCents' | 'totalCents'>) => {
    setFormData((prev) => {
      const existingIndex = prev.lineItems.findIndex(
        (li) => li.shopifyVariantId === item.shopifyVariantId && !li.isFreeItem
      );

      let newLineItems: OrderLineItem[];

      if (existingIndex >= 0) {
        // Existing item - add to quantity
        newLineItems = prev.lineItems.map((li, index) => {
          if (index === existingIndex) {
            const increment = li.quantityIncrement ?? 1;
            const newQty = validateQuantity(
              li.quantity + (item.quantity || increment),
              li.quantityMin,
              li.quantityMax,
              li.quantityIncrement
            );
            const unitPrice = getEffectiveUnitPrice(li.basePriceCents, newQty, li.priceBreaks);
            return {
              ...li,
              quantity: newQty,
              unitPriceCents: unitPrice,
              totalCents: unitPrice * newQty - li.discountCents,
            };
          }
          return li;
        });
      } else {
        // New item - use min quantity as starting point
        const initialQty = validateQuantity(
          item.quantity || item.quantityMin || 1,
          item.quantityMin,
          item.quantityMax,
          item.quantityIncrement
        );
        const basePriceCents = item.basePriceCents || item.unitPriceCents;
        const unitPrice = getEffectiveUnitPrice(basePriceCents, initialQty, item.priceBreaks || []);

        const newItem: OrderLineItem = {
          ...item,
          id: generateTempId(),
          quantity: initialQty,
          basePriceCents,
          unitPriceCents: unitPrice,
          discountCents: 0,
          totalCents: unitPrice * initialQty,
          priceBreaks: item.priceBreaks || [],
        };
        newLineItems = [...prev.lineItems, newItem];
      }

      return {
        ...prev,
        lineItems: newLineItems,
      };
    });
  }, []);

  const updateLineItemQuantity = useCallback((itemId: string, quantity: number) => {
    setFormData((prev) => ({
      ...prev,
      lineItems: prev.lineItems.map((item) => {
        if (item.id === itemId) {
          // Validate quantity against rules
          const validQty = validateQuantity(
            quantity,
            item.quantityMin,
            item.quantityMax,
            item.quantityIncrement
          );
          // Apply volume pricing
          const unitPrice = getEffectiveUnitPrice(item.basePriceCents, validQty, item.priceBreaks);
          return {
            ...item,
            quantity: validQty,
            unitPriceCents: unitPrice,
            totalCents: unitPrice * validQty - item.discountCents,
          };
        }
        return item;
      }),
    }));
  }, []);

  const removeLineItem = useCallback((itemId: string) => {
    setFormData((prev) => ({
      ...prev,
      lineItems: prev.lineItems.filter((item) => item.id !== itemId),
    }));
  }, []);

  // Shipping handler
  const setShippingOption = useCallback((option: ShippingOption | null) => {
    setFormData((prev) => ({
      ...prev,
      selectedShippingOption: option,
      shippingCents: option?.priceCents || 0,
    }));
  }, []);

  // Note and PO number handlers
  const setNote = useCallback((note: string) => {
    setFormData((prev) => ({ ...prev, note }));
  }, []);

  const setPoNumber = useCallback((poNumber: string) => {
    setFormData((prev) => ({ ...prev, poNumber }));
  }, []);

  // Payment terms handler
  const setPaymentTerms = useCallback((paymentTerms: PaymentTerms) => {
    setFormData((prev) => ({ ...prev, paymentTerms }));
  }, []);

  // Tax update handler
  const setTax = useCallback((taxCents: number) => {
    setFormData((prev) => ({
      ...prev,
      taxCents,
      totalCents: Math.max(0, prev.subtotalCents - prev.discountCents + prev.shippingCents + taxCents),
    }));
  }, []);

  // Totals update
  // LINE_ITEM discounts are baked into subtotal, ORDER_TOTAL shown separately
  const updateTotals = useCallback((
    lineItems: OrderLineItem[],
    appliedPromotions: AppliedPromotion[],
    lineItemDiscountCents: number,
    orderDiscountCents: number
  ) => {
    setFormData((prev) => {
      const regularItems = lineItems.filter((item) => !item.isFreeItem);

      // Gross subtotal (before any discounts)
      const grossSubtotalCents = regularItems.reduce(
        (sum, item) => sum + item.unitPriceCents * item.quantity,
        0
      );

      // Net subtotal (after LINE_ITEM discounts - this is what we display as "Subtotal")
      const subtotalCents = grossSubtotalCents - lineItemDiscountCents;

      const shippingCents = prev.selectedShippingOption?.priceCents || 0;
      const taxCents = prev.taxCents;

      // Total = subtotal - ORDER_TOTAL discounts + shipping + tax
      const totalCents = Math.max(0, subtotalCents - orderDiscountCents + shippingCents + taxCents);

      return {
        ...prev,
        lineItems,
        appliedPromotions,
        subtotalCents,
        discountCents: orderDiscountCents,  // Only ORDER_TOTAL discounts
        totalCents,
      };
    });
  }, []);

  return {
    formData,
    setFormData,
    isDirty,
    resetForm,
    updateInitialRef,
    setCompany,
    setContact,
    setShippingLocation,
    setBillingLocation,
    addLineItem,
    updateLineItemQuantity,
    removeLineItem,
    setShippingOption,
    setNote,
    setPoNumber,
    setPaymentTerms,
    setTax,
    updateTotals,
  };
}

export default useOrderForm;
