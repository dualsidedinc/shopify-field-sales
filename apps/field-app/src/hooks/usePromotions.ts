'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  evaluatePromotions,
  type PromotionInput,
  type PromotionScope,
  type EngineLineItem,
  type EvaluationResult,
  type ProductInfo,
} from '@field-sales/shared';
import { api } from '@/lib/api';
import { isFreeLineItem, type OrderLineItem, type AppliedPromotion } from './useOrderForm';

export interface AvailablePromotion {
  id: string;
  name: string;
  description: string | null;
  type: 'PERCENTAGE' | 'FIXED_AMOUNT' | 'BUY_X_GET_Y' | 'SPEND_GET_FREE';
  scope: PromotionScope;
  value: number;
  minOrderCents: number | null;
  buyQuantity: number | null;
  buyProductIds: string[];
  getQuantity: number | null;
  getProductIds: string[];
  stackable: boolean;
  priority: number;
}

interface FreeItemProduct {
  variantId: string;
  productId: string;
  title: string;
  variantTitle: string | null;
  priceCents: number;
  sku: string | null;
}

interface UsePromotionsConfig {
  locationId?: string | null;
}

interface UsePromotionsResult {
  availablePromotions: AvailablePromotion[];
  loading: boolean;
  evaluateCart: (lineItems: OrderLineItem[]) => {
    lineItems: OrderLineItem[];
    appliedPromotions: AppliedPromotion[];
    lineItemDiscountCents: number;   // LINE_ITEM scope discounts (included in subtotal)
    orderDiscountCents: number;      // ORDER_TOTAL scope discounts (shown separately)
    discountCents: number;           // Total of all discounts (for display)
  };
}

export function usePromotions(config?: UsePromotionsConfig): UsePromotionsResult {
  const locationId = config?.locationId;
  const [availablePromotions, setAvailablePromotions] = useState<AvailablePromotion[]>([]);
  const [freeItemProducts, setFreeItemProducts] = useState<FreeItemProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const prevPromotionIdsRef = useRef<string[]>([]);

  // Build product catalog from free item products
  const productCatalog = useMemo(() => {
    const catalog = new Map<string, ProductInfo>();
    for (const product of freeItemProducts) {
      catalog.set(product.variantId, {
        productId: product.productId,
        variantId: product.variantId,
        title: product.title,
        variantTitle: product.variantTitle || undefined,
        priceCents: product.priceCents,
        sku: product.sku || undefined,
      });
    }
    return catalog;
  }, [freeItemProducts]);

  // Fetch active promotions (refetch when locationId changes for catalog pricing)
  useEffect(() => {
    async function fetchPromotions() {
      setLoading(true);
      try {
        // Build URL with optional locationId for catalog-aware pricing
        const params = new URLSearchParams();
        if (locationId) {
          params.set('locationId', locationId);
        }
        const url = `/api/promotions${params.toString() ? `?${params}` : ''}`;

        const response = await fetch(url);
        const result = await response.json();

        if (result.data) {
          const responseData = result.data as {
            promotions: AvailablePromotion[];
            freeItemProducts: FreeItemProduct[];
          };
          setAvailablePromotions(responseData.promotions);
          setFreeItemProducts(responseData.freeItemProducts);
        }
      } catch (error) {
        console.error('Error fetching promotions:', error);
      } finally {
        setLoading(false);
      }
    }

    fetchPromotions();
  }, [locationId]);

  // Evaluate cart against promotions
  const evaluateCart = useCallback(
    (lineItems: OrderLineItem[]) => {
      // Filter out free items for evaluation — they're engine output, not
      // user input. Feeding them back in would make the engine treat them as
      // regular purchases and add ANOTHER free item on top.
      const regularItems = lineItems.filter((item) => !isFreeLineItem(item));
      // Preserve ids of already-saved free line items so we can reuse them
      // instead of generating synthetic `free_...` ids on every re-evaluation.
      const existingFreeItems = lineItems.filter(isFreeLineItem);

      if (regularItems.length === 0 || availablePromotions.length === 0) {
        return {
          lineItems: regularItems,
          appliedPromotions: [],
          lineItemDiscountCents: 0,
          orderDiscountCents: 0,
          discountCents: 0,
        };
      }

      // Convert to engine format
      const engineLineItems: EngineLineItem[] = regularItems.map((item) => ({
        id: item.id,
        productId: item.shopifyProductId,
        variantId: item.shopifyVariantId,
        quantity: item.quantity,
        unitPriceCents: item.unitPriceCents,
        title: item.title,
        variantTitle: item.variantTitle || undefined,
      }));

      const promotionInputs: PromotionInput[] = availablePromotions.map((p) => ({
        id: p.id,
        name: p.name,
        type: p.type,
        scope: p.scope,
        value: p.value,
        minOrderCents: p.minOrderCents,
        buyQuantity: p.buyQuantity,
        buyProductIds: p.buyProductIds,
        getQuantity: p.getQuantity,
        getProductIds: p.getProductIds,
        stackable: p.stackable,
        priority: p.priority,
      }));

      // Evaluate with product catalog for free item lookups
      const result: EvaluationResult = evaluatePromotions(engineLineItems, promotionInputs, productCatalog);

      // Convert applied promotions
      const appliedPromotions: AppliedPromotion[] = result.appliedPromotions.map((p) => ({
        id: p.id,
        name: p.name,
        type: p.type,
        scope: p.scope as PromotionScope,
        discountCents: p.discountCents,
      }));

      // Build final line items including free items
      let finalLineItems: OrderLineItem[] = [...regularItems];

      if (result.freeItemsToAdd.length > 0) {
        const freeItems: OrderLineItem[] = result.freeItemsToAdd.map((freeItem) => {
          // Reuse the saved line item if this free gift already exists on the
          // order (same promotion + variant). Keeps the DB id stable across
          // re-evaluations so the UI always reflects a real persisted item.
          const existing = existingFreeItems.find(
            (li) =>
              li.promotionId === freeItem.promotionId &&
              li.shopifyVariantId === freeItem.variantId
          );

          return {
            id: existing?.id ?? `free_${freeItem.promotionId}_${freeItem.productId}`,
            shopifyProductId: freeItem.productId,
            shopifyVariantId: freeItem.variantId,
            sku: existing?.sku ?? null,
            title: freeItem.title,
            variantTitle: freeItem.variantTitle || null,
            imageUrl: existing?.imageUrl ?? null,
            quantity: freeItem.quantity,
            unitPriceCents: freeItem.unitPriceCents,
            basePriceCents: freeItem.unitPriceCents,
            discountCents: freeItem.unitPriceCents * freeItem.quantity,
            totalCents: 0,
            promotionId: freeItem.promotionId,
            promotionName: freeItem.promotionName,
            quantityMin: null,
            quantityMax: null,
            quantityIncrement: null,
            priceBreaks: [],
          };
        });

        finalLineItems = [...regularItems, ...freeItems];
      }

      // Track promotion changes for notifications
      const newPromotionIds = appliedPromotions.map((p) => p.id);
      const addedPromotions = appliedPromotions.filter(
        (p) => !prevPromotionIdsRef.current.includes(p.id)
      );
      const removedIds = prevPromotionIdsRef.current.filter(
        (id) => !newPromotionIds.includes(id)
      );

      prevPromotionIdsRef.current = newPromotionIds;

      // Log promotion changes (can be used for toast notifications)
      if (addedPromotions.length > 0) {
        console.log('Promotions applied:', addedPromotions.map((p) => p.name).join(', '));
      }
      if (removedIds.length > 0) {
        console.log('Promotions removed');
      }

      // Calculate LINE_ITEM vs ORDER_TOTAL discounts
      // - PERCENTAGE/FIXED_AMOUNT LINE_ITEM: Reduces line item price → reduces subtotal
      // - BUY_X_GET_Y/SPEND_GET_FREE: Adds free item at $0 → does NOT reduce subtotal
      // - ORDER_TOTAL: Shown as separate discount after subtotal
      let lineItemDiscountCents = 0;
      let orderDiscountCents = 0;

      for (const promo of result.appliedPromotions) {
        if (promo.scope === 'LINE_ITEM') {
          // Only PERCENTAGE and FIXED_AMOUNT reduce the subtotal
          // BUY_X_GET_Y and SPEND_GET_FREE add free items, they don't reduce existing items
          if (promo.type === 'PERCENTAGE' || promo.type === 'FIXED_AMOUNT') {
            lineItemDiscountCents += promo.discountCents;
          }
          // Free item promotions (BUY_X_GET_Y, SPEND_GET_FREE) don't reduce subtotal
        } else if (promo.scope === 'ORDER_TOTAL') {
          orderDiscountCents += promo.discountCents;
        }
      }

      return {
        lineItems: finalLineItems,
        appliedPromotions,
        lineItemDiscountCents,
        orderDiscountCents,
        discountCents: result.totalDiscountCents,
      };
    },
    [availablePromotions, productCatalog]
  );

  return {
    availablePromotions,
    loading,
    evaluateCart,
  };
}

export default usePromotions;
