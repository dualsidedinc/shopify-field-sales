import prisma from "../db.server";
import type { Promotion } from "@field-sales/database";
import {
  evaluatePromotions as evaluatePromotionsEngine,
  type PromotionType,
  type PromotionScope,
  type PromotionInput,
  type EngineLineItem,
  type ProductInfo,
} from "@field-sales/shared";

/**
 * Server-side promotion evaluation. Runs the shared engine against active
 * shop promotions, then collapses the result into the shape the order API
 * needs (line items + free items + scope-separated discounts).
 *
 * Authoritative for the field-app create/replace flows — those routes proxy
 * here rather than running their own evaluation.
 */

export interface CartLineItem {
  variantId: string;
  shopifyVariantId: string;
  productId: string;
  shopifyProductId: string;
  title: string;
  variantTitle: string | null;
  quantity: number;
  unitPriceCents: number;
}

export interface LineItemDiscount {
  promotionId: string;
  promotionName: string;
  type: PromotionType;
  discountCents: number;
  discountPerUnit: number;
}

export interface CartLineItemWithDiscount extends CartLineItem {
  discounts: LineItemDiscount[];
  totalDiscountCents: number;
  finalPriceCents: number;
  isFreeItem?: boolean;
  promotionId?: string;
}

export interface PromotionEvaluationResult {
  lineItems: CartLineItemWithDiscount[];
  grossSubtotalCents: number;
  subtotalCents: number;
  lineItemDiscountCents: number;
  orderDiscountCents: number;
  totalDiscountCents: number;
  finalTotalCents: number;
  appliedPromotions: Array<{
    id: string;
    name: string;
    type: PromotionType;
    scope: PromotionScope;
    totalDiscountCents: number;
  }>;
}

async function getActivePromotions(shopId: string): Promise<Promotion[]> {
  const now = new Date();
  return prisma.promotion.findMany({
    where: {
      shopId,
      isActive: true,
      startsAt: { lte: now },
      OR: [{ endsAt: null }, { endsAt: { gte: now } }],
    },
    orderBy: { priority: "desc" },
  });
}

function toPromotionInput(promotion: Promotion): PromotionInput {
  return {
    id: promotion.id,
    name: promotion.name,
    type: promotion.type as PromotionType,
    scope: promotion.scope as PromotionScope,
    value: Number(promotion.value),
    minOrderCents: promotion.minOrderCents,
    buyQuantity: promotion.buyQuantity,
    buyProductIds: promotion.buyProductIds,
    getQuantity: promotion.getQuantity,
    getProductIds: promotion.getProductIds,
    stackable: promotion.stackable,
    priority: promotion.priority,
  };
}

function calculateSubtotal(lineItems: CartLineItem[]): number {
  return lineItems.reduce((sum, item) => sum + item.unitPriceCents * item.quantity, 0);
}

export async function evaluatePromotions(
  shopId: string,
  lineItems: CartLineItem[],
  productCatalog?: Map<string, ProductInfo>
): Promise<PromotionEvaluationResult> {
  const grossSubtotalCents = calculateSubtotal(lineItems);

  const dbPromotions = await getActivePromotions(shopId);

  if (dbPromotions.length === 0) {
    return {
      lineItems: lineItems.map((item) => ({
        ...item,
        discounts: [],
        totalDiscountCents: 0,
        finalPriceCents: item.unitPriceCents * item.quantity,
      })),
      grossSubtotalCents,
      subtotalCents: grossSubtotalCents,
      lineItemDiscountCents: 0,
      orderDiscountCents: 0,
      totalDiscountCents: 0,
      finalTotalCents: grossSubtotalCents,
      appliedPromotions: [],
    };
  }

  const engineLineItems: EngineLineItem[] = lineItems.map((item) => ({
    id: item.variantId,
    productId: item.shopifyProductId,
    variantId: item.shopifyVariantId,
    quantity: item.quantity,
    unitPriceCents: item.unitPriceCents,
    title: item.title,
    variantTitle: item.variantTitle || undefined,
  }));

  const promotionInputs: PromotionInput[] = dbPromotions.map(toPromotionInput);

  const engineResult = evaluatePromotionsEngine(engineLineItems, promotionInputs, productCatalog);

  let lineItemDiscountCents = 0;
  let orderDiscountCents = 0;
  const lineItemDiscountMap = new Map<string, LineItemDiscount[]>();

  for (const applied of engineResult.appliedPromotions) {
    if (applied.scope === "LINE_ITEM") {
      if (applied.type === "PERCENTAGE" || applied.type === "FIXED_AMOUNT") {
        lineItemDiscountCents += applied.discountCents;
        // Distribute proportionally to line items
        for (const item of lineItems) {
          const itemTotal = item.unitPriceCents * item.quantity;
          const itemShare = grossSubtotalCents > 0 ? itemTotal / grossSubtotalCents : 0;
          const discountCents = Math.round(applied.discountCents * itemShare);
          const discountPerUnit = Math.round(discountCents / item.quantity);
          const existing = lineItemDiscountMap.get(item.variantId) || [];
          existing.push({
            promotionId: applied.id,
            promotionName: applied.name,
            type: applied.type,
            discountCents,
            discountPerUnit,
          });
          lineItemDiscountMap.set(item.variantId, existing);
        }
      }
    } else if (applied.scope === "ORDER_TOTAL") {
      orderDiscountCents += applied.discountCents;
    }
  }

  const itemsWithDiscounts: CartLineItemWithDiscount[] = lineItems.map((item) => {
    const discounts = lineItemDiscountMap.get(item.variantId) || [];
    const totalDiscountCents = discounts.reduce((sum, d) => sum + d.discountCents, 0);
    return {
      ...item,
      discounts,
      totalDiscountCents,
      finalPriceCents: item.unitPriceCents * item.quantity - totalDiscountCents,
    };
  });

  for (const freeItem of engineResult.freeItemsToAdd) {
    itemsWithDiscounts.push({
      variantId: freeItem.variantId,
      shopifyVariantId: freeItem.variantId,
      productId: freeItem.productId,
      shopifyProductId: freeItem.productId,
      title: freeItem.title,
      variantTitle: freeItem.variantTitle || null,
      quantity: freeItem.quantity,
      unitPriceCents: freeItem.unitPriceCents,
      discounts: [
        {
          promotionId: freeItem.promotionId,
          promotionName: freeItem.promotionName,
          type: "BUY_X_GET_Y",
          discountCents: freeItem.unitPriceCents * freeItem.quantity,
          discountPerUnit: freeItem.unitPriceCents,
        },
      ],
      totalDiscountCents: freeItem.unitPriceCents * freeItem.quantity,
      finalPriceCents: 0,
      isFreeItem: true,
      promotionId: freeItem.promotionId,
    });
  }

  const netSubtotalCents = grossSubtotalCents - lineItemDiscountCents;

  return {
    lineItems: itemsWithDiscounts,
    grossSubtotalCents,
    subtotalCents: netSubtotalCents,
    lineItemDiscountCents,
    orderDiscountCents,
    totalDiscountCents: engineResult.totalDiscountCents,
    finalTotalCents: netSubtotalCents - orderDiscountCents,
    appliedPromotions: engineResult.appliedPromotions.map((p) => ({
      id: p.id,
      name: p.name,
      type: p.type,
      scope: p.scope,
      totalDiscountCents: p.discountCents,
    })),
  };
}
