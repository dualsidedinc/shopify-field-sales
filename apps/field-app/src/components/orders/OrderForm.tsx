'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useOrderForm, isFreeLineItem, type InitialOrderData, type OrderLineItem } from '@/hooks/useOrderForm';
import { getOrderStatusLabel } from '@/lib/orderStatus';
import { usePromotions } from '@/hooks/usePromotions';
import { SaveBar, useToast, useSaveBarContext } from '../ui';
import { CompanySection } from './CompanySection';
import { ProductsSection } from './ProductsSection';
import { OrderSummary } from './OrderSummary';
import { PaymentSection } from './PaymentSection';
import { OrderAttributes } from './OrderAttributes';
import { TimelineSection } from './TimelineSection';
import { StatusActions } from './StatusActions';
import type { SelectedProduct } from '../pickers/ProductPicker';
import type { ShippingOption } from '@/hooks/useOrderForm';

interface OrderFormProps {
  mode: 'create' | 'edit';
  companyId?: string;      // Pre-select from account page
  orderId?: string;        // For edit mode
  initialData?: InitialOrderData;
  onSuccess?: (orderId: string) => void;
}

export function OrderForm({
  mode,
  companyId,
  orderId,
  initialData,
  onSuccess,
}: OrderFormProps) {
  const router = useRouter();
  const { showToast } = useToast();
  const { triggerShake } = useSaveBarContext();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shippingOptions, setShippingOptions] = useState<ShippingOption[]>([]);

  // Initialize form with initial data
  const {
    formData,
    setFormData,
    isDirty,
    resetForm,
    updateInitialRef,
    setCompany,
    setContact,
    setShippingLocation,
    addLineItem,
    updateLineItemQuantity,
    removeLineItem,
    setShippingOption,
    setNote,
    setPoNumber,
    setTax,
    updateTotals,
  } = useOrderForm(initialData);

  // Apply a server response (from submit/approve/decline/addComment) to the
  // local form. router.refresh() doesn't re-trigger the parent's useEffect
  // refetch, so without this the status + timeline would stay stale and
  // status-driven UI (like the Submit button) wouldn't update.
  const applyServerOrderUpdate = useCallback(
    (data: { status?: string; timelineEvents?: unknown[] } | null | undefined) => {
      if (!data) return;
      setFormData((prev) => ({
        ...prev,
        ...(data.status && { status: data.status as typeof prev.status }),
        ...(data.timelineEvents && {
          timelineEvents: data.timelineEvents as typeof prev.timelineEvents,
        }),
      }));
    },
    [setFormData]
  );

  // Tax calculation state
  const [isCalculatingTax, setIsCalculatingTax] = useState(false);
  const taxCalculationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Pass location for catalog-aware pricing on free items
  const { evaluateCart, loading: promotionsLoading } = usePromotions({
    locationId: formData.shippingLocation?.id,
  });

  // Determine if form is readonly
  const isReadonly = formData.status !== 'DRAFT';
  const canApprove = formData.status === 'AWAITING_REVIEW';

  // Fetch company data if companyId is provided (for pre-selection)
  useEffect(() => {
    if (companyId && mode === 'create' && !formData.company) {
      fetchCompany(companyId);
    }
  }, [companyId, mode]);

  // Fetch shipping options
  useEffect(() => {
    fetchShippingOptions();
  }, []);

  // Re-evaluate promotions when line items change
  // Create a stable key based on line items to detect changes
  const lineItemsKey = formData.lineItems
    .filter((item) => !isFreeLineItem(item))
    .map((item) => `${item.shopifyVariantId}:${item.quantity}`)
    .join(',');

  useEffect(() => {
    if (!promotionsLoading) {
      const regularItems = formData.lineItems.filter((item) => !isFreeLineItem(item));
      if (regularItems.length > 0) {
        const result = evaluateCart(formData.lineItems);
        updateTotals(
          result.lineItems,
          result.appliedPromotions,
          result.lineItemDiscountCents,
          result.orderDiscountCents
        );
      } else {
        // No items - clear promotions
        updateTotals([], [], 0, 0);
      }
    }
  }, [lineItemsKey, promotionsLoading, evaluateCart, updateTotals]);

  async function fetchCompany(id: string) {
    try {
      const { data } = await api.client.companies.get(id);
      if (data) {
        setCompany({
          id: data.id,
          name: data.name,
          accountNumber: data.accountNumber,
          territoryName: (data as { territory?: { name: string } }).territory?.name,
        });
      }
    } catch (err) {
      console.error('Error fetching company:', err);
    }
  }

  async function fetchShippingOptions() {
    try {
      const { data } = await api.client.shippingMethods.list();
      if (data) {
        setShippingOptions(data as ShippingOption[]);
      }
    } catch (err) {
      console.error('Error fetching shipping options:', err);
    }
  }

  // Calculate tax when conditions change
  const calculateTax = useCallback(async () => {
    const regularLineItems = formData.lineItems.filter((li) => !isFreeLineItem(li));
    if (regularLineItems.length === 0) return;
    if (!formData.shippingLocation) return;

    setIsCalculatingTax(true);

    try {
      const { data } = await api.client.tax.calculate({
        lineItems: regularLineItems.map((li) => ({
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
          countryCode: formData.shippingLocation.country || 'US',
        },
        shippingCents: formData.shippingCents,
      });

      if (data) {
        setTax(data.taxCents);
      }
    } catch (err) {
      console.error('Error calculating tax:', err);
    } finally {
      setIsCalculatingTax(false);
    }
  }, [formData.lineItems, formData.shippingLocation, formData.shippingCents, setTax]);

  // Trigger tax calculation when shipping address or line items change (debounced)
  useEffect(() => {
    if (!formData.shippingLocation) return;
    const regularLineItems = formData.lineItems.filter((li) => !isFreeLineItem(li));
    if (regularLineItems.length === 0) return;

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

  // Handle adding a product from picker
  const handleAddProduct = useCallback(
    (product: SelectedProduct) => {
      // Use quantityMin as initial quantity, defaulting to 1
      const initialQuantity = product.quantityMin ?? 1;
      const newItem: Omit<OrderLineItem, 'id' | 'discountCents' | 'totalCents'> = {
        shopifyProductId: product.shopifyProductId,
        shopifyVariantId: product.shopifyVariantId,
        sku: product.sku || null,
        title: product.title,
        variantTitle: product.variantTitle || null,
        imageUrl: product.imageUrl,
        quantity: initialQuantity,
        unitPriceCents: product.priceCents,
        basePriceCents: product.basePriceCents,
        // Quantity rules from B2B catalog
        quantityMin: product.quantityMin,
        quantityMax: product.quantityMax,
        quantityIncrement: product.quantityIncrement,
        priceBreaks: product.priceBreaks,
      };
      addLineItem(newItem);
      // Promotions will be re-evaluated by the useEffect when lineItems.length changes
    },
    [addLineItem]
  );

  // Handle quantity change
  const handleUpdateQuantity = useCallback(
    (itemId: string, quantity: number) => {
      updateLineItemQuantity(itemId, quantity);
      // Promotions will be re-evaluated by the useEffect when lineItems change
    },
    [updateLineItemQuantity]
  );

  // Handle remove item
  const handleRemoveItem = useCallback(
    (itemId: string) => {
      removeLineItem(itemId);
      // Promotions will be re-evaluated by the useEffect when lineItems change
    },
    [removeLineItem]
  );

  // Save draft order
  async function handleSave() {
    if (!formData.company) {
      setError('Please select a company');
      showToast('Please select a company', 'error');
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      const payload = buildOrderPayload();

      if (mode === 'create' || !orderId) {
        const { data, error: apiError } = await api.client.orders.create(payload as never);

        if (apiError) {
          setError(apiError.message || 'Failed to create order');
          showToast(apiError.message || 'Failed to create order', 'error');
          return;
        }

        updateInitialRef();
        showToast('Order created successfully', 'success');
        onSuccess?.(data!.id);
        router.push(`/orders/${data!.id}`);
      } else {
        const { error: apiError } = await api.client.orders.replace(orderId, payload as never);

        if (apiError) {
          setError(apiError.message || 'Failed to save order');
          showToast(apiError.message || 'Failed to save order', 'error');
          return;
        }

        updateInitialRef();
        showToast('Order saved successfully', 'success');
        onSuccess?.(orderId);
      }
    } catch (err) {
      console.error('Error saving order:', err);
      setError('An unexpected error occurred');
      showToast('An unexpected error occurred', 'error');
    } finally {
      setIsSaving(false);
    }
  }

  // Submit for approval
  async function handleSubmitForApproval(comment?: string) {
    if (!formData.company) {
      setError('Please select a company');
      return;
    }

    if (formData.lineItems.filter((item) => !isFreeLineItem(item)).length === 0) {
      setError('Please add at least one product');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      // Save first if dirty
      if (isDirty || mode === 'create') {
        const payload = buildOrderPayload();

        if (mode === 'create' || !orderId) {
          const { data, error: apiError } = await api.client.orders.create({
            ...payload,
            submitForApproval: true,
            comment,
          } as never);

          if (apiError) {
            setError(apiError.message || 'Failed to submit order');
            return;
          }

          updateInitialRef();
          onSuccess?.(data!.id);
          router.push(`/orders/${data!.id}`);
        } else {
          const { data, error: apiError } = await api.client.orders.submit(orderId, comment);

          if (apiError) {
            setError(apiError.message || 'Failed to submit order');
            return;
          }

          applyServerOrderUpdate(data);
          updateInitialRef();
          router.refresh();
        }
      } else {
        // Just submit
        const { data, error: apiError } = await api.client.orders.submit(orderId!, comment);

        if (apiError) {
          setError(apiError.message || 'Failed to submit order');
          return;
        }

        applyServerOrderUpdate(data);
        router.refresh();
      }
    } catch (err) {
      console.error('Error submitting order:', err);
      setError('An unexpected error occurred');
    } finally {
      setIsSubmitting(false);
    }
  }

  // Approve order
  async function handleApprove(comment?: string) {
    if (!orderId) return;

    setIsSubmitting(true);
    setError(null);

    try {
      const { data, error: apiError } = await api.client.orders.approve(orderId, comment);

      if (apiError) {
        setError(apiError.message || 'Failed to approve order');
        return;
      }

      applyServerOrderUpdate(data);
      router.refresh();
    } catch (err) {
      console.error('Error approving order:', err);
      setError('An unexpected error occurred');
    } finally {
      setIsSubmitting(false);
    }
  }

  // Decline order
  async function handleDecline(comment?: string) {
    if (!orderId) return;

    setIsSubmitting(true);
    setError(null);

    try {
      const { data, error: apiError } = await api.client.orders.decline(orderId, comment);

      if (apiError) {
        setError(apiError.message || 'Failed to decline order');
        return;
      }

      applyServerOrderUpdate(data);
      router.refresh();
    } catch (err) {
      console.error('Error declining order:', err);
      setError('An unexpected error occurred');
    } finally {
      setIsSubmitting(false);
    }
  }

  // Add comment to timeline
  async function handleAddComment(comment: string) {
    if (!orderId) return;

    try {
      const { data } = await api.client.orders.addComment(orderId, comment);
      applyServerOrderUpdate(data);
      router.refresh();
    } catch (err) {
      console.error('Error adding comment:', err);
    }
  }

  // Delete order
  async function handleDelete() {
    if (!orderId) return;

    setIsSubmitting(true);
    setError(null);

    try {
      const { error: apiError } = await api.client.orders.delete(orderId);

      if (apiError) {
        setError(apiError.message || 'Failed to delete order');
        return;
      }

      // Navigate back to orders list
      router.push('/orders');
    } catch (err) {
      console.error('Error deleting order:', err);
      setError('An unexpected error occurred');
    } finally {
      setIsSubmitting(false);
    }
  }

  // Status badge helpers
  function getStatusBadgeColor(status: string): string {
    switch (status) {
      case 'DRAFT':
        return 'bg-gray-100 text-gray-700';
      case 'AWAITING_REVIEW':
        return 'bg-yellow-100 text-yellow-700';
      case 'PENDING':
        return 'bg-blue-100 text-blue-700';
      case 'PAID':
        return 'bg-green-100 text-green-700';
      case 'CANCELLED':
      case 'REFUNDED':
        return 'bg-red-100 text-red-700';
      default:
        return 'bg-gray-100 text-gray-700';
    }
  }

  const getStatusLabel = getOrderStatusLabel;

  // Build order payload for API
  function buildOrderPayload() {
    return {
      companyId: formData.company!.id,
      contactId: formData.contact?.id,
      shippingLocationId: formData.shippingLocation?.id,
      billingLocationId: formData.billingLocation?.id,
      lineItems: formData.lineItems.map((item) => ({
        shopifyProductId: item.shopifyProductId,
        shopifyVariantId: item.shopifyVariantId,
        sku: item.sku,
        title: item.title,
        variantTitle: item.variantTitle,
        imageUrl: item.imageUrl,
        quantity: item.quantity,
        unitPriceCents: item.unitPriceCents,
        isFreeItem: isFreeLineItem(item),
        promotionId: item.promotionId || null,
        promotionName: item.promotionName || null,
      })),
      appliedPromotionIds: formData.appliedPromotions.map((p) => p.id),
      shippingMethodId: formData.selectedShippingOption?.id,
      note: formData.note || null,
      poNumber: formData.poNumber || null,
      subtotalCents: formData.subtotalCents,
      discountCents: formData.discountCents,
      shippingCents: formData.shippingCents,
      taxCents: formData.taxCents,
      totalCents: formData.totalCents,
      currency: formData.currency,
    };
  }

  return (
    <div className="pb-20">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-white border-b border-gray-200 px-4 py-2 -mx-4 mb-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <button
              type="button"
              onClick={() => {
                if (isDirty) {
                  triggerShake();
                } else {
                  router.back();
                }
              }}
              className="p-1.5 -ml-1.5 text-gray-500 hover:text-gray-700 flex-shrink-0"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <h1 className="text-base font-semibold text-gray-900 truncate">
                  {mode === 'create' ? 'New Order' : `${formData.orderNumber || 'Order'}`}
                </h1>
                {mode === 'edit' && (
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium flex-shrink-0 ${getStatusBadgeColor(formData.status)}`}>
                    {getStatusLabel(formData.status)}
                  </span>
                )}
              </div>
              {formData.company && (
                <p className="text-xs text-gray-500 truncate">{formData.company.name}</p>
              )}
            </div>
          </div>
          {/* Submit for Approval button */}
          {formData.status === 'DRAFT' && (
            <button
              type="button"
              onClick={() => handleSubmitForApproval()}
              disabled={
                isSubmitting ||
                !formData.company ||
                formData.lineItems.filter((item) => !isFreeLineItem(item)).length === 0
              }
              className="btn-primary text-xs px-3 disabled:opacity-50 flex-shrink-0 whitespace-nowrap"
            >
              {isSubmitting ? 'Submitting...' : 'Submit for Approval'}
            </button>
          )}
        </div>
      </div>

      {/* Error Message */}
      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {/* Form Sections */}
      <div className="space-y-4">
        {/* Company Section */}
        <CompanySection
          company={formData.company}
          contact={formData.contact}
          shippingLocation={formData.shippingLocation}
          onCompanyChange={setCompany}
          onContactChange={setContact}
          onShippingLocationChange={setShippingLocation}
          readonly={isReadonly}
        />

        {/* Products Section */}
        <ProductsSection
          lineItems={formData.lineItems}
          currency={formData.currency}
          onAddProduct={handleAddProduct}
          onUpdateQuantity={handleUpdateQuantity}
          onRemoveItem={handleRemoveItem}
          readonly={isReadonly}
          companyLocationId={formData.shippingLocation?.id}
        />

        {/* Order Summary */}
        <OrderSummary
          lineItems={formData.lineItems}
          appliedPromotions={formData.appliedPromotions}
          subtotalCents={formData.subtotalCents}
          discountCents={formData.discountCents}
          shippingCents={formData.shippingCents}
          taxCents={formData.taxCents}
          totalCents={formData.totalCents}
          currency={formData.currency}
          shippingOptions={shippingOptions}
          selectedShippingOption={formData.selectedShippingOption}
          onSelectShipping={setShippingOption}
          readonly={isReadonly}
          isCalculatingTax={isCalculatingTax}
        />

        {/* Payment Section */}
        <PaymentSection
          shippingLocation={formData.shippingLocation}
          contact={formData.contact}
          paymentTerms={formData.paymentTerms}
        />

        {/* Order Attributes */}
        <OrderAttributes
          poNumber={formData.poNumber}
          note={formData.note}
          onPoNumberChange={setPoNumber}
          onNoteChange={setNote}
          readonly={isReadonly}
        />

        {/* Timeline (only for existing orders) */}
        {mode === 'edit' && formData.timelineEvents.length > 0 && (
          <TimelineSection
            events={formData.timelineEvents}
            onAddComment={handleAddComment}
          />
        )}

        {/* Status Actions (for edit mode) - approve/decline/delete only, submit is in header */}
        {mode === 'edit' && (formData.status === 'AWAITING_REVIEW' || formData.status === 'DRAFT') && (
          <StatusActions
            status={formData.status}
            hasLineItems={formData.lineItems.filter((item) => !isFreeLineItem(item)).length > 0}
            isSubmitting={isSubmitting}
            shopifyOrderId={formData.shopifyOrderId}
            onApprove={canApprove ? handleApprove : undefined}
            onDecline={canApprove ? handleDecline : undefined}
            onDelete={handleDelete}
          />
        )}
      </div>

      {/* Save Bar */}
      {!isReadonly && (
        <SaveBar
          isDirty={isDirty}
          onSave={handleSave}
          onDiscard={resetForm}
          isSaving={isSaving}
        />
      )}
    </div>
  );
}

export default OrderForm;
