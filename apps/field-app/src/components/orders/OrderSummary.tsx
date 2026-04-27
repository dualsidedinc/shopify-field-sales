'use client';

import { isFreeLineItem, type AppliedPromotion, type ShippingOption, type OrderLineItem } from '@/hooks/useOrderForm';

interface OrderSummaryProps {
  lineItems: OrderLineItem[];
  appliedPromotions: AppliedPromotion[];
  subtotalCents: number;
  discountCents: number;
  shippingCents: number;
  taxCents: number;
  totalCents: number;
  currency: string;
  shippingOptions: ShippingOption[];
  selectedShippingOption: ShippingOption | null;
  onSelectShipping: (option: ShippingOption | null) => void;
  readonly?: boolean;
  isCalculatingTax?: boolean;
}

function formatPrice(cents: number, currency: string = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
  }).format(cents / 100);
}

export function OrderSummary({
  lineItems,
  appliedPromotions,
  subtotalCents,
  discountCents,
  shippingCents,
  taxCents,
  totalCents,
  currency,
  shippingOptions,
  selectedShippingOption,
  onSelectShipping,
  readonly = false,
  isCalculatingTax = false,
}: OrderSummaryProps) {
  // Count only regular items (not free items)
  const regularItems = lineItems.filter((item) => !isFreeLineItem(item));
  const freeItems = lineItems.filter(isFreeLineItem);
  const itemCount = regularItems.reduce((sum, item) => sum + item.quantity, 0);

  // Separate promotions by type for display
  const lineItemPromotions = appliedPromotions.filter((p) => p.scope === 'LINE_ITEM');
  const orderPromotions = appliedPromotions.filter((p) => p.scope === 'ORDER_TOTAL');

  // Calculate total savings for display
  const totalSavingsCents = appliedPromotions.reduce((sum, p) => sum + p.discountCents, 0);

  return (
    <div className="card">
      <h2 className="font-semibold text-gray-900 mb-4">Order Summary</h2>

      <div className="space-y-3">
        {/* Subtotal */}
        <div className="flex justify-between items-center text-sm">
          <div className="flex items-center gap-2">
            <span className="text-gray-600">Subtotal</span>
            <span className="text-gray-400">
              ({itemCount} {itemCount === 1 ? 'item' : 'items'})
            </span>
          </div>
          <span className="font-medium">{formatPrice(subtotalCents, currency)}</span>
        </div>

        {/* Order Discount (ORDER_TOTAL promotions) */}
        {discountCents > 0 && (
          <div className="flex justify-between items-center text-sm text-green-600">
            <span>Order Discount</span>
            <span className="font-medium">-{formatPrice(discountCents, currency)}</span>
          </div>
        )}

        {/* Shipping */}
        <div className="flex justify-between items-center text-sm">
          {readonly ? (
            <>
              <span className="text-gray-600">
                {selectedShippingOption?.title || 'Shipping'}
              </span>
              <span className="font-medium">
                {selectedShippingOption
                  ? formatPrice(shippingCents, currency)
                  : 'Not selected'}
              </span>
            </>
          ) : (
            <>
              <select
                value={selectedShippingOption?.id || ''}
                onChange={(e) => {
                  const option = shippingOptions.find((o) => o.id === e.target.value);
                  onSelectShipping(option || null);
                }}
                className="text-sm text-gray-600 bg-white border border-gray-200 rounded-md px-2 py-1 pr-7 focus:outline-none focus:ring-1 focus:ring-primary-500 focus:border-primary-500 cursor-pointer appearance-none"
                style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%239CA3AF'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M19 9l-7 7-7-7'%3E%3C/path%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 6px center', backgroundSize: '14px' }}
              >
                <option value="">Select shipping...</option>
                {shippingOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.title}
                  </option>
                ))}
              </select>
              <span className="font-medium">
                {selectedShippingOption
                  ? formatPrice(shippingCents, currency)
                  : '—'}
              </span>
            </>
          )}
        </div>

        {/* Tax */}
        <div className="flex justify-between items-center text-sm">
          <div className="flex items-center gap-1">
            <span className="text-gray-600">Estimated Tax</span>
            {isCalculatingTax && (
              <svg
                className="w-4 h-4 text-gray-400 animate-spin"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                />
              </svg>
            )}
          </div>
          <span className="font-medium">{formatPrice(taxCents, currency)}</span>
        </div>

        {/* Total */}
        <div className="pt-3 border-t border-gray-200">
          <div className="flex justify-between items-center">
            <span className="text-lg font-semibold text-gray-900">Total Due</span>
            <span className="text-lg font-bold text-gray-900">
              {formatPrice(totalCents, currency)}
            </span>
          </div>
        </div>

        {/* Promotions Applied Section - After Total */}
        {appliedPromotions.length > 0 && (
          <div className="pt-4 mt-2 border-t border-gray-200">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <svg className="w-5 h-5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A2 2 0 013 12V7a4 4 0 014-4z" />
                </svg>
                <span className="font-semibold text-gray-900">Promotions Applied</span>
              </div>
              <span className="bg-green-100 text-green-700 text-sm font-semibold px-2.5 py-0.5 rounded-full">
                {formatPrice(totalSavingsCents, currency)} saved
              </span>
            </div>

            <div className="space-y-3 bg-green-50 rounded-lg p-3">
              {/* Line Item Promotions (Free Items) */}
              {lineItemPromotions.map((promo) => {
                const freeItem = freeItems.find((item) => item.promotionId === promo.id);
                return (
                  <div key={promo.id} className="flex items-start gap-2 text-sm">
                    <svg className="w-4 h-4 text-green-600 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    <div className="flex-1">
                      <p className="font-medium text-green-700">{promo.name}</p>
                      {freeItem && (
                        <p className="text-green-600 text-xs">
                          Free: {freeItem.title} {freeItem.variantTitle ? `(${freeItem.variantTitle})` : ''} x{freeItem.quantity}
                        </p>
                      )}
                    </div>
                    <span className="text-green-600 font-medium whitespace-nowrap">
                      {formatPrice(promo.discountCents, currency)}
                    </span>
                  </div>
                );
              })}

              {/* Order Total Promotions */}
              {orderPromotions.map((promo) => (
                <div key={promo.id} className="flex items-start gap-2 text-sm">
                  <svg className="w-4 h-4 text-green-600 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  <div className="flex-1">
                    <p className="font-medium text-green-700">{promo.name}</p>
                    <p className="text-green-600 text-xs">Order discount applied</p>
                  </div>
                  <span className="text-green-600 font-medium whitespace-nowrap">
                    {formatPrice(promo.discountCents, currency)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default OrderSummary;
