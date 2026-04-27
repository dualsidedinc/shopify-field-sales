'use client';

import { ProductPicker, type SelectedProduct } from '../pickers/ProductPicker';
import {
  isFreeLineItem,
  isDiscountedLineItem,
  type OrderLineItem,
} from '@/hooks/useOrderForm';

interface ProductsSectionProps {
  lineItems: OrderLineItem[];
  currency: string;
  onAddProduct: (product: SelectedProduct) => void;
  onUpdateQuantity: (itemId: string, quantity: number) => void;
  onRemoveItem: (itemId: string) => void;
  readonly?: boolean;
  /** Company location ID for catalog-specific pricing and quantity rules */
  companyLocationId?: string | null;
}

function formatPrice(cents: number, currency: string = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
  }).format(cents / 100);
}

/**
 * Format quantity rule info for display
 */
function getQuantityRuleLabel(item: OrderLineItem): string | null {
  const parts: string[] = [];

  if (item.quantityMin && item.quantityMin > 1) {
    parts.push(`Min: ${item.quantityMin}`);
  }
  if (item.quantityIncrement && item.quantityIncrement > 1) {
    parts.push(`Packs of ${item.quantityIncrement}`);
  }
  if (item.quantityMax) {
    parts.push(`Max: ${item.quantityMax}`);
  }

  return parts.length > 0 ? parts.join(' · ') : null;
}

export function ProductsSection({
  lineItems,
  currency,
  onAddProduct,
  onUpdateQuantity,
  onRemoveItem,
  readonly = false,
  companyLocationId,
}: ProductsSectionProps) {
  // Sort items by price descending (free items naturally end up at the bottom)
  const sortedItems = [...lineItems].sort((a, b) => b.totalCents - a.totalCents);

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-2">
        <h2 className="font-semibold text-gray-900">Products</h2>
        {!readonly && (
          <ProductPicker
            onSelect={onAddProduct}
            buttonLabel="Add Product"
            companyLocationId={companyLocationId}
          />
        )}
      </div>

      {lineItems.length === 0 ? (
        <div className="text-center py-8 rounded-lg">
          <svg
            className="w-12 h-12 mx-auto text-gray-300 mb-3"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1}
              d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z"
            />
          </svg>
          <p className="text-gray-500">No products added yet</p>
          {!readonly && (
            <p className="text-sm text-gray-400 mt-1">
              Tap &quot;Add Products&quot; to start building your order
            </p>
          )}
        </div>
      ) : (
        <ul className="divide-y divide-gray-100">
          {sortedItems.map((item) => {
            const isFree = isFreeLineItem(item);
            const isDiscounted = isDiscountedLineItem(item);
            const hasPromo = isFree || isDiscounted;
            const grossCents = item.unitPriceCents * item.quantity;

            return (
              <li
                key={item.id}
                className={`flex gap-3 py-3 first:pt-1 last:pb-1 ${
                  isFree ? '-mx-2 px-2 rounded-lg bg-green-50' : ''
                }`}
              >
                {/* Product Image */}
                <div className={`w-16 h-16 rounded-lg overflow-hidden flex-shrink-0 ${
                  isFree ? 'bg-green-100' : 'bg-gray-100'
                }`}>
                  {item.imageUrl ? (
                    <img
                      src={item.imageUrl}
                      alt={item.title}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className={`w-full h-full flex items-center justify-center ${
                      isFree ? 'text-green-400' : 'text-gray-400'
                    }`}>
                      <svg
                        className="w-8 h-8"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        {isFree ? (
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={1}
                            d="M12 8v13m0-13V6a2 2 0 112 2h-2zm0 0V5.5A2.5 2.5 0 109.5 8H12zm-7 4h14M5 12a2 2 0 110-4h14a2 2 0 110 4M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7"
                          />
                        ) : (
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={1}
                            d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                          />
                        )}
                      </svg>
                    </div>
                  )}
                </div>

                {/* Product Info */}
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-gray-900 truncate">{item.title}</p>
                  {item.variantTitle && (
                    <p className="text-sm text-gray-500">{item.variantTitle}</p>
                  )}
                  {hasPromo && item.promotionName ? (
                    <p className="text-xs text-green-600 mt-1">{item.promotionName}</p>
                  ) : (
                    <p className="text-sm text-primary-600 font-semibold mt-1">
                      {formatPrice(item.unitPriceCents, currency)}
                    </p>
                  )}
                </div>

                {/* Quantity & Price/Badge */}
                <div className="flex flex-col items-end justify-between">
                  {isFree || readonly ? (
                    <span className="text-sm text-gray-500">Qty: {item.quantity}</span>
                  ) : (
                    <div className="flex flex-col items-end gap-1">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            const increment = item.quantityIncrement ?? 1;
                            const min = item.quantityMin ?? 1;
                            const newQty = item.quantity - increment;
                            if (newQty < min) {
                              onRemoveItem(item.id);
                            } else {
                              onUpdateQuantity(item.id, newQty);
                            }
                          }}
                          className="w-8 h-8 rounded-full border border-gray-300 flex items-center justify-center text-gray-600 hover:bg-gray-100"
                        >
                          {item.quantity <= (item.quantityMin ?? 1) ? (
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          ) : (
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
                            </svg>
                          )}
                        </button>
                        <span className="w-8 text-center font-medium">{item.quantity}</span>
                        <button
                          type="button"
                          onClick={() => {
                            const increment = item.quantityIncrement ?? 1;
                            const newQty = item.quantity + increment;
                            // Don't exceed max if set
                            if (item.quantityMax && newQty > item.quantityMax) return;
                            onUpdateQuantity(item.id, newQty);
                          }}
                          disabled={item.quantityMax !== null && item.quantity >= item.quantityMax}
                          className="w-8 h-8 rounded-full border border-gray-300 flex items-center justify-center text-gray-600 hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                          </svg>
                        </button>
                      </div>
                      {/* Show quantity rule info */}
                      {getQuantityRuleLabel(item) && (
                        <span className="text-xs text-gray-400">{getQuantityRuleLabel(item)}</span>
                      )}
                    </div>
                  )}
                  {isFree ? (
                    <span className="bg-green-500 text-white text-xs px-2 py-0.5 rounded font-medium">
                      FREE
                    </span>
                  ) : isDiscounted ? (
                    <div className="text-right">
                      <p className="text-xs text-gray-400 line-through">
                        {formatPrice(grossCents, currency)}
                      </p>
                      <p className="text-sm font-semibold text-green-700">
                        {formatPrice(item.totalCents, currency)}
                      </p>
                    </div>
                  ) : (
                    <div className="text-right">
                      <p className="text-sm font-semibold text-gray-900">
                        {formatPrice(item.totalCents, currency)}
                      </p>
                      {/* Show if volume pricing is applied */}
                      {item.priceBreaks && item.priceBreaks.length > 0 && item.unitPriceCents < item.basePriceCents && (
                        <p className="text-xs text-green-600">Volume discount applied</p>
                      )}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export default ProductsSection;
