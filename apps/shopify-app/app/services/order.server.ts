import { prisma } from "@field-sales/database";
import type { OrderStatus, PaymentTerms, PromotionType, PromotionScope } from "@prisma/client";
import { toGid, fromGid } from "../lib/shopify-ids";
import { recordBilledOrder, getCurrentBillingPeriod, PLAN_CONFIGS } from "./billing.server";
import { buildOrderMetafields, ensureMetafieldSetupForShop, type OrderMetafieldData } from "./metafield.server";
import {
  evaluatePromotions,
  type EngineLineItem,
  type PromotionInput,
  type ProductInfo,
} from "@field-sales/shared";

// Types
export interface OrderListItem {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  companyId: string;
  companyName: string;
  salesRepName: string;
  totalCents: number;
  currency: string;
  lineItemCount: number;
  createdAt: string;
  placedAt: string | null;
}

export interface OrderShippingMethod {
  id: string;
  title: string;
  priceCents: number;
}

export interface OrderDetail {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  shopifyDraftOrderId: string | null;
  shopifyOrderId: string | null;
  shopifyOrderNumber: string | null;
  company: {
    id: string;
    name: string;
    accountNumber: string | null;
  };
  salesRep: {
    id: string;
    name: string;
  };
  contact: {
    id: string;
    name: string;
    email: string;
  } | null;
  shippingLocation: OrderAddress | null;
  billingLocation: OrderAddress | null;
  shippingMethod: OrderShippingMethod | null;
  lineItems: OrderLineItemDetail[];
  appliedPromotions: OrderAppliedPromotion[];
  note: string | null;
  poNumber: string | null;
  subtotalCents: number;
  discountCents: number;
  shippingCents: number;
  taxCents: number;
  totalCents: number;
  currency: string;
  paymentTerms: PaymentTerms;
  paymentDueDate: string | null;
  paidAt: string | null;
  placedAt: string | null;
  cancelledAt: string | null;
  refundedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OrderAddress {
  id: string;
  name: string;
  address1: string | null;
  address2: string | null;
  city: string | null;
  province: string | null;
  provinceCode: string | null;
  zipcode: string | null;
  country: string;
  countryCode: string;
  phone: string | null;
}

export interface OrderLineItemDetail {
  id: string;
  shopifyProductId: string | null;
  shopifyVariantId: string | null;
  sku: string | null;
  title: string;
  variantTitle: string | null;
  quantity: number;
  unitPriceCents: number;
  discountCents: number;
  taxCents: number;
  totalCents: number;
  fulfilledQuantity: number;
  // Promotion tracking
  isPromotionItem: boolean;
  promotionId: string | null;
  promotionName: string | null;
}

export interface OrderAppliedPromotion {
  id: string;
  name: string;
  type: PromotionType;
  scope: PromotionScope;
  value: number;
  discountCents: number;
}

export interface CreateOrderInput {
  shopId: string;
  companyId: string;
  salesRepId: string;
  contactId?: string | null;
  shippingLocationId?: string | null;
  billingLocationId?: string | null;
  note?: string | null;
  poNumber?: string | null;
  paymentTerms?: PaymentTerms;
  lineItems: CreateLineItemInput[];
}

export interface CreateLineItemInput {
  shopifyProductId?: string | null;
  shopifyVariantId?: string | null;
  sku?: string | null;
  title: string;
  variantTitle?: string | null;
  imageUrl?: string | null;
  quantity: number;
  unitPriceCents: number;
  discountCents?: number;
  totalCents?: number; // If provided, use directly instead of calculating
  // Promotion tracking
  isPromotionItem?: boolean;
  promotionId?: string | null;
  promotionName?: string | null;
}

export interface UpdateOrderInput {
  contactId?: string | null;
  shippingLocationId?: string | null;
  billingLocationId?: string | null;
  shippingMethodId?: string | null;
  shippingCents?: number;
  note?: string | null;
  poNumber?: string | null;
  paymentTerms?: PaymentTerms;
}

export interface UpdateLineItemInput {
  id?: string; // If provided, update existing; otherwise create new
  shopifyProductId?: string | null;
  shopifyVariantId?: string | null;
  sku?: string | null;
  title: string;
  variantTitle?: string | null;
  imageUrl?: string | null;
  quantity: number;
  unitPriceCents: number;
  discountCents?: number;
  totalCents?: number; // If provided, use directly instead of calculating
  // Promotion tracking
  isPromotionItem?: boolean;
  promotionId?: string | null;
  promotionName?: string | null;
}

// Helper to generate order number
async function generateOrderNumber(shopId: string): Promise<string> {
  // Get shop settings for order numbering
  const shop = await prisma.shop.findUnique({
    where: { id: shopId },
    select: { orderPrefix: true, orderNumberStart: true },
  });

  const prefix = shop?.orderPrefix || "FS";
  const startNumber = shop?.orderNumberStart || 1;

  // Count existing orders and determine next number
  const count = await prisma.order.count({ where: { shopId } });
  const nextNumber = Math.max(startNumber, count + 1);

  return `${prefix}-${nextNumber}`;
}

// Helper to calculate line item total
function calculateLineItemTotal(item: { quantity: number; unitPriceCents: number; discountCents?: number; taxCents?: number }): number {
  const subtotal = item.quantity * item.unitPriceCents;
  const discount = item.discountCents || 0;
  const tax = item.taxCents || 0;
  return subtotal - discount + tax;
}

// Helper to calculate order totals
function calculateOrderTotals(lineItems: Array<{ quantity: number; unitPriceCents: number; discountCents?: number; taxCents?: number }>) {
  let subtotalCents = 0;
  let discountCents = 0;
  let taxCents = 0;

  for (const item of lineItems) {
    subtotalCents += item.quantity * item.unitPriceCents;
    discountCents += item.discountCents || 0;
    taxCents += item.taxCents || 0;
  }

  const totalCents = subtotalCents - discountCents + taxCents;

  return { subtotalCents, discountCents, taxCents, totalCents };
}

// Queries
export async function getOrders(
  shopId: string,
  options?: {
    salesRepId?: string;
    companyId?: string;
    status?: OrderStatus;
    limit?: number;
    offset?: number;
  }
): Promise<OrderListItem[]> {
  const orders = await prisma.order.findMany({
    where: {
      shopId,
      deletedAt: null, // Exclude soft-deleted orders
      ...(options?.salesRepId && { salesRepId: options.salesRepId }),
      ...(options?.companyId && { companyId: options.companyId }),
      ...(options?.status && { status: options.status }),
    },
    include: {
      company: { select: { name: true } },
      salesRep: { select: { firstName: true, lastName: true } },
      lineItems: { select: { id: true } },
    },
    orderBy: { createdAt: "desc" },
    take: options?.limit || 50,
    skip: options?.offset || 0,
  });

  return orders.map((o) => ({
    id: o.id,
    orderNumber: o.orderNumber,
    status: o.status,
    companyId: o.companyId,
    companyName: o.company.name,
    salesRepName: `${o.salesRep.firstName} ${o.salesRep.lastName}`,
    totalCents: o.totalCents,
    currency: o.currency,
    lineItemCount: o.lineItems.length,
    createdAt: o.createdAt.toISOString(),
    placedAt: o.placedAt?.toISOString() || null,
  }));
}

export async function getOrderById(
  shopId: string,
  orderId: string
): Promise<OrderDetail | null> {
  const order = await prisma.order.findFirst({
    where: { id: orderId, shopId, deletedAt: null },
    include: {
      company: { select: { id: true, name: true, accountNumber: true } },
      salesRep: { select: { id: true, firstName: true, lastName: true } },
      contact: { select: { id: true, firstName: true, lastName: true, email: true } },
      shippingLocation: true,
      billingLocation: true,
      shippingMethod: { select: { id: true, title: true, priceCents: true } },
      lineItems: { orderBy: { createdAt: "asc" } },
    },
  });

  if (!order) return null;

  // Aggregate applied promotions from line items (LINE_ITEM scope promotions)
  // Group by promotionId and calculate total discount per promotion
  const promotionMap = new Map<string, { name: string; discountCents: number }>();
  for (const li of order.lineItems) {
    if (li.promotionId && li.promotionName) {
      const existing = promotionMap.get(li.promotionId);
      if (existing) {
        // For free items, the discount is the full item value
        existing.discountCents += li.discountCents;
      } else {
        promotionMap.set(li.promotionId, {
          name: li.promotionName,
          discountCents: li.discountCents,
        });
      }
    }
  }

  // Combine line item promotion IDs with stored appliedPromotionIds (includes ORDER_TOTAL)
  const lineItemPromoIds = [...promotionMap.keys()];
  let storedPromoIds = order.appliedPromotionIds || [];

  // For legacy orders: if there's a discount but no stored ORDER_TOTAL promotion IDs,
  // try to find matching active promotions by re-evaluating
  const hasOrderLevelDiscount = order.discountCents > 0;
  const hasStoredOrderTotalPromos = storedPromoIds.length > lineItemPromoIds.length;

  if (hasOrderLevelDiscount && !hasStoredOrderTotalPromos) {
    // Re-evaluate to find ORDER_TOTAL promotions for legacy orders
    const now = new Date();
    const activePromotions = await prisma.promotion.findMany({
      where: {
        shopId,
        isActive: true,
        scope: "ORDER_TOTAL",
        startsAt: { lte: now },
        OR: [{ endsAt: null }, { endsAt: { gte: now } }],
      },
      select: { id: true, name: true, type: true, scope: true, value: true, minOrderCents: true },
    });

    // Check which ORDER_TOTAL promotions would qualify for this order
    for (const promo of activePromotions) {
      const meetsMinOrder = !promo.minOrderCents || order.subtotalCents >= promo.minOrderCents;
      if (meetsMinOrder) {
        // Calculate what discount this promotion would give
        let expectedDiscount = 0;
        if (promo.type === "PERCENTAGE") {
          expectedDiscount = Math.round(order.subtotalCents * (Number(promo.value) / 100));
        } else if (promo.type === "FIXED_AMOUNT") {
          expectedDiscount = Math.min(Math.round(Number(promo.value) * 100), order.subtotalCents);
        }

        // If this matches the stored discount, this promotion was likely applied
        if (expectedDiscount === order.discountCents) {
          storedPromoIds = [...storedPromoIds, promo.id];
          break; // Only one ORDER_TOTAL promotion can apply
        }
      }
    }
  }

  const allPromoIds = [...new Set([...lineItemPromoIds, ...storedPromoIds])];

  // Fetch promotion details to get types, scopes, and values
  let appliedPromotions: OrderAppliedPromotion[] = [];

  if (allPromoIds.length > 0) {
    const promotions = await prisma.promotion.findMany({
      where: { id: { in: allPromoIds } },
      select: { id: true, name: true, type: true, scope: true, value: true },
    });

    appliedPromotions = promotions.map((p) => {
      // For LINE_ITEM promotions, use the discount from line items
      // For ORDER_TOTAL promotions, calculate based on type and value
      const lineItemDiscount = promotionMap.get(p.id)?.discountCents;
      let discountCents = lineItemDiscount || 0;

      // For ORDER_TOTAL promotions not tracked in line items, calculate the discount
      if (p.scope === "ORDER_TOTAL" && !lineItemDiscount) {
        const subtotal = order.subtotalCents;
        if (p.type === "PERCENTAGE") {
          discountCents = Math.round(subtotal * (Number(p.value) / 100));
        } else if (p.type === "FIXED_AMOUNT") {
          discountCents = Math.min(Math.round(Number(p.value) * 100), subtotal);
        }
      }

      return {
        id: p.id,
        name: promotionMap.get(p.id)?.name || p.name,
        type: p.type,
        scope: p.scope,
        value: Number(p.value),
        discountCents,
      };
    });
  }

  return {
    id: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    shopifyDraftOrderId: order.shopifyDraftOrderId,
    shopifyOrderId: order.shopifyOrderId,
    shopifyOrderNumber: order.shopifyOrderNumber,
    company: {
      id: order.company.id,
      name: order.company.name,
      accountNumber: order.company.accountNumber,
    },
    salesRep: {
      id: order.salesRep.id,
      name: `${order.salesRep.firstName} ${order.salesRep.lastName}`,
    },
    contact: order.contact
      ? {
          id: order.contact.id,
          name: `${order.contact.firstName} ${order.contact.lastName}`,
          email: order.contact.email,
        }
      : null,
    shippingLocation: order.shippingLocation
      ? {
          id: order.shippingLocation.id,
          name: order.shippingLocation.name,
          address1: order.shippingLocation.address1,
          address2: order.shippingLocation.address2,
          city: order.shippingLocation.city,
          province: order.shippingLocation.province,
          provinceCode: order.shippingLocation.provinceCode,
          zipcode: order.shippingLocation.zipcode,
          country: order.shippingLocation.country,
          countryCode: order.shippingLocation.countryCode,
          phone: order.shippingLocation.phone,
        }
      : null,
    billingLocation: order.billingLocation
      ? {
          id: order.billingLocation.id,
          name: order.billingLocation.name,
          address1: order.billingLocation.address1,
          address2: order.billingLocation.address2,
          city: order.billingLocation.city,
          province: order.billingLocation.province,
          provinceCode: order.billingLocation.provinceCode,
          zipcode: order.billingLocation.zipcode,
          country: order.billingLocation.country,
          countryCode: order.billingLocation.countryCode,
          phone: order.billingLocation.phone,
        }
      : null,
    shippingMethod: order.shippingMethod
      ? {
          id: order.shippingMethod.id,
          title: order.shippingMethod.title,
          priceCents: order.shippingMethod.priceCents,
        }
      : null,
    lineItems: order.lineItems.map((li) => ({
      id: li.id,
      shopifyProductId: li.shopifyProductId,
      shopifyVariantId: li.shopifyVariantId,
      sku: li.sku,
      title: li.title,
      variantTitle: li.variantTitle,
      quantity: li.quantity,
      unitPriceCents: li.unitPriceCents,
      discountCents: li.discountCents,
      taxCents: li.taxCents,
      totalCents: li.totalCents,
      fulfilledQuantity: li.fulfilledQuantity,
      isPromotionItem: li.isPromotionItem,
      promotionId: li.promotionId,
      promotionName: li.promotionName,
    })),
    appliedPromotions,
    note: order.note,
    poNumber: order.poNumber,
    subtotalCents: order.subtotalCents,
    discountCents: order.discountCents,
    shippingCents: order.shippingCents,
    taxCents: order.taxCents,
    totalCents: order.totalCents,
    currency: order.currency,
    paymentTerms: order.paymentTerms,
    paymentDueDate: order.paymentDueDate?.toISOString() || null,
    paidAt: order.paidAt?.toISOString() || null,
    placedAt: order.placedAt?.toISOString() || null,
    cancelledAt: order.cancelledAt?.toISOString() || null,
    refundedAt: order.refundedAt?.toISOString() || null,
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
  };
}

export async function getOrdersBySalesRep(
  shopId: string,
  salesRepId: string,
  options?: { status?: OrderStatus; limit?: number }
): Promise<OrderListItem[]> {
  return getOrders(shopId, { salesRepId, ...options });
}

export async function getOrdersByCompany(
  shopId: string,
  companyId: string,
  options?: { status?: OrderStatus; limit?: number }
): Promise<OrderListItem[]> {
  return getOrders(shopId, { companyId, ...options });
}

// Mutations
export async function createOrder(
  input: CreateOrderInput
): Promise<{ success: true; orderId: string } | { success: false; error: string }> {
  const { shopId, companyId, salesRepId, contactId, shippingLocationId, billingLocationId, note, poNumber, paymentTerms, lineItems } = input;

  if (lineItems.length === 0) {
    return { success: false, error: "Order must have at least one line item" };
  }

  // Verify company exists and belongs to shop
  const company = await prisma.company.findFirst({
    where: { id: companyId, shopId, isActive: true },
  });

  if (!company) {
    return { success: false, error: "Company not found" };
  }

  // Verify sales rep exists and belongs to shop
  const salesRep = await prisma.salesRep.findFirst({
    where: { id: salesRepId, shopId, isActive: true },
  });

  if (!salesRep) {
    return { success: false, error: "Sales rep not found" };
  }

  try {
    const orderNumber = await generateOrderNumber(shopId);
    const totals = calculateOrderTotals(lineItems);

    const order = await prisma.order.create({
      data: {
        shopId,
        companyId,
        salesRepId,
        contactId: contactId || null,
        shippingLocationId: shippingLocationId || null,
        billingLocationId: billingLocationId || null,
        orderNumber,
        status: "DRAFT",
        note: note || null,
        poNumber: poNumber || null,
        paymentTerms: paymentTerms || company.paymentTerms,
        ...totals,
        lineItems: {
          create: lineItems.map((li) => ({
            shopifyProductId: li.shopifyProductId || null,
            shopifyVariantId: li.shopifyVariantId || null,
            sku: li.sku || null,
            title: li.title,
            variantTitle: li.variantTitle || null,
            imageUrl: li.imageUrl || null,
            quantity: li.quantity,
            unitPriceCents: li.unitPriceCents,
            discountCents: li.discountCents || 0,
            totalCents: li.totalCents !== undefined ? li.totalCents : calculateLineItemTotal(li),
            isPromotionItem: li.isPromotionItem || false,
            promotionId: li.promotionId || null,
            promotionName: li.promotionName || null,
          })),
        },
      },
    });

    return { success: true, orderId: order.id };
  } catch (error) {
    console.error("Error creating order:", error);
    return { success: false, error: "Failed to create order" };
  }
}

export async function updateOrder(
  shopId: string,
  orderId: string,
  input: UpdateOrderInput
): Promise<{ success: true } | { success: false; error: string }> {
  const order = await prisma.order.findFirst({
    where: { id: orderId, shopId },
  });

  if (!order) {
    return { success: false, error: "Order not found" };
  }

  if (order.status !== "DRAFT") {
    return { success: false, error: "Can only update draft orders" };
  }

  try {
    await prisma.order.update({
      where: { id: orderId },
      data: {
        ...(input.contactId !== undefined && { contactId: input.contactId || null }),
        ...(input.shippingLocationId !== undefined && { shippingLocationId: input.shippingLocationId || null }),
        ...(input.billingLocationId !== undefined && { billingLocationId: input.billingLocationId || null }),
        ...(input.shippingMethodId !== undefined && { shippingMethodId: input.shippingMethodId || null }),
        ...(input.shippingCents !== undefined && { shippingCents: input.shippingCents }),
        ...(input.note !== undefined && { note: input.note || null }),
        ...(input.poNumber !== undefined && { poNumber: input.poNumber || null }),
        ...(input.paymentTerms && { paymentTerms: input.paymentTerms }),
      },
    });

    return { success: true };
  } catch (error) {
    console.error("Error updating order:", error);
    return { success: false, error: "Failed to update order" };
  }
}

export async function updateOrderLineItems(
  shopId: string,
  orderId: string,
  lineItems: UpdateLineItemInput[]
): Promise<{ success: true } | { success: false; error: string }> {
  const order = await prisma.order.findFirst({
    where: { id: orderId, shopId },
    include: { lineItems: true },
  });

  if (!order) {
    return { success: false, error: "Order not found" };
  }

  if (order.status !== "DRAFT") {
    return { success: false, error: "Can only update line items on draft orders" };
  }

  // Filter to only regular (non-promotion) line items from input
  const regularLineItems = lineItems.filter(li => !li.isPromotionItem);

  if (regularLineItems.length === 0) {
    return { success: false, error: "Order must have at least one line item" };
  }

  try {
    await prisma.$transaction(async (tx) => {
      // Delete ALL existing line items (we'll recreate them)
      await tx.orderLineItem.deleteMany({
        where: { orderId },
      });

      // Create regular line items
      for (const li of regularLineItems) {
        const totalCents = li.totalCents !== undefined ? li.totalCents : calculateLineItemTotal(li);
        await tx.orderLineItem.create({
          data: {
            orderId,
            shopifyProductId: li.shopifyProductId || null,
            shopifyVariantId: li.shopifyVariantId || null,
            sku: li.sku || null,
            title: li.title,
            variantTitle: li.variantTitle || null,
            imageUrl: li.imageUrl || null,
            quantity: li.quantity,
            unitPriceCents: li.unitPriceCents,
            discountCents: li.discountCents || 0,
            totalCents,
            isPromotionItem: false,
            promotionId: null,
            promotionName: null,
          },
        });
      }

      // Get active promotions for this shop
      const now = new Date();
      const promotions = await tx.promotion.findMany({
        where: {
          shopId,
          isActive: true,
          startsAt: { lte: now },
          OR: [
            { endsAt: null },
            { endsAt: { gte: now } },
          ],
        },
      });

      // Evaluate promotions if any exist
      let orderLevelDiscountCents = 0; // Only PERCENTAGE and FIXED_AMOUNT discounts
      let appliedPromoIds: string[] = []; // Track all applied promotion IDs
      if (promotions.length > 0) {
        // Convert line items to engine format
        const engineLineItems: EngineLineItem[] = regularLineItems.map(li => ({
          id: li.id || '',
          productId: li.shopifyProductId || '',
          variantId: li.shopifyVariantId || '',
          quantity: li.quantity,
          unitPriceCents: li.unitPriceCents,
          title: li.title,
          variantTitle: li.variantTitle || undefined,
          sku: li.sku || undefined,
        }));

        // Convert promotions to engine format
        const promotionInputs: PromotionInput[] = promotions.map(p => ({
          id: p.id,
          name: p.name,
          type: p.type as PromotionType,
          scope: p.scope as PromotionScope,
          value: Number(p.value),
          minOrderCents: p.minOrderCents,
          buyQuantity: p.buyQuantity,
          buyProductIds: p.buyProductIds,
          getQuantity: p.getQuantity,
          getProductIds: p.getProductIds,
          stackable: p.stackable,
          priority: p.priority,
        }));

        // Build product catalog for free item lookups (by variant ID)
        const productCatalog = new Map<string, ProductInfo>();
        const allVariantIds = new Set<string>();
        for (const p of promotions) {
          for (const variantId of (p.getProductIds || [])) {
            allVariantIds.add(variantId);
          }
        }

        if (allVariantIds.size > 0) {
          // Look up variants directly by their Shopify variant ID
          const variants = await tx.productVariant.findMany({
            where: {
              shopifyVariantId: { in: [...allVariantIds] },
              product: { shopId },
            },
            include: {
              product: true,
            },
          });

          for (const variant of variants) {
            productCatalog.set(variant.shopifyVariantId, {
              productId: variant.product.shopifyProductId,
              variantId: variant.shopifyVariantId,
              title: variant.product.title,
              variantTitle: variant.title !== 'Default Title' ? variant.title : undefined,
              priceCents: variant.priceCents,
              sku: variant.sku || undefined,
            });
          }
        }

        // Evaluate promotions
        const result = evaluatePromotions(engineLineItems, promotionInputs, productCatalog);

        // Calculate order-level discounts only (scope: ORDER_TOTAL)
        // Line-item discounts (scope: LINE_ITEM) are already reflected in the $0 free items
        // Look up scope for each applied promotion
        appliedPromoIds = result.appliedPromotions.map(p => p.id);
        const promoScopes = new Map<string, string>();
        for (const p of promotions) {
          promoScopes.set(p.id, p.scope);
        }

        for (const appliedPromo of result.appliedPromotions) {
          const scope = promoScopes.get(appliedPromo.id);
          if (scope === 'ORDER_TOTAL') {
            orderLevelDiscountCents += appliedPromo.discountCents;
          }
        }

        // Deduplicate free items by productId+promotionId (combine quantities if duplicates)
        const freeItemMap = new Map<string, typeof result.freeItemsToAdd[0]>();
        for (const freeItem of result.freeItemsToAdd) {
          const key = `${freeItem.productId}_${freeItem.promotionId}`;
          const existing = freeItemMap.get(key);
          if (existing) {
            // Combine quantities for duplicate product+promotion
            existing.quantity += freeItem.quantity;
          } else {
            freeItemMap.set(key, { ...freeItem });
          }
        }
        const dedupedFreeItems = [...freeItemMap.values()];

        // Create free items from promotion results
        for (const freeItem of dedupedFreeItems) {
          const productInfo = productCatalog.get(freeItem.productId);
          await tx.orderLineItem.create({
            data: {
              orderId,
              shopifyProductId: freeItem.productId,
              shopifyVariantId: freeItem.variantId,
              sku: freeItem.sku || productInfo?.sku || null,
              title: freeItem.title,
              variantTitle: freeItem.variantTitle || null,
              imageUrl: null,
              quantity: freeItem.quantity,
              unitPriceCents: freeItem.unitPriceCents,
              discountCents: freeItem.unitPriceCents * freeItem.quantity, // Full discount for free item
              totalCents: 0, // Free item
              isPromotionItem: true,
              promotionId: freeItem.promotionId,
              promotionName: freeItem.promotionName,
            },
          });
        }
      }

      // Recalculate order totals
      // Note: Line-item discounts (free items) are already $0 in line items
      // Only order-level discounts (PERCENTAGE, FIXED_AMOUNT) go into discountCents
      const subtotalCents = regularLineItems.reduce(
        (sum, li) => sum + (li.quantity * li.unitPriceCents),
        0
      );
      const totals = {
        subtotalCents,
        discountCents: orderLevelDiscountCents,
        taxCents: 0, // TODO: Calculate tax
        totalCents: Math.max(0, subtotalCents - orderLevelDiscountCents),
        appliedPromotionIds: appliedPromoIds,
      };
      await tx.order.update({
        where: { id: orderId },
        data: totals,
      });
    });

    return { success: true };
  } catch (error) {
    console.error("Error updating order line items:", error);
    return { success: false, error: "Failed to update line items" };
  }
}

export async function cancelOrder(
  shopId: string,
  orderId: string
): Promise<{ success: true } | { success: false; error: string }> {
  const order = await prisma.order.findFirst({
    where: { id: orderId, shopId },
  });

  if (!order) {
    return { success: false, error: "Order not found" };
  }

  if (order.status === "CANCELLED" || order.status === "REFUNDED") {
    return { success: false, error: "Order is already cancelled or refunded" };
  }

  try {
    await prisma.order.update({
      where: { id: orderId },
      data: {
        status: "CANCELLED",
        cancelledAt: new Date(),
      },
    });

    return { success: true };
  } catch (error) {
    console.error("Error cancelling order:", error);
    return { success: false, error: "Failed to cancel order" };
  }
}

export async function deleteOrder(
  shopId: string,
  orderId: string
): Promise<{ success: true } | { success: false; error: string }> {
  const order = await prisma.order.findFirst({
    where: { id: orderId, shopId },
  });

  if (!order) {
    return { success: false, error: "Order not found" };
  }

  if (order.status !== "DRAFT") {
    return { success: false, error: "Can only delete draft orders" };
  }

  try {
    await prisma.order.delete({
      where: { id: orderId },
    });

    return { success: true };
  } catch (error) {
    console.error("Error deleting order:", error);
    return { success: false, error: "Failed to delete order" };
  }
}

/**
 * Submit a draft order for review
 * Moves order from DRAFT to AWAITING_REVIEW
 */
export async function submitOrderForReview(
  shopId: string,
  orderId: string
): Promise<{ success: true; order: { salesRepId: string; salesRepName: string } } | { success: false; error: string }> {
  const order = await prisma.order.findFirst({
    where: { id: orderId, shopId },
    include: { salesRep: true },
  });

  if (!order) {
    return { success: false, error: "Order not found" };
  }

  if (order.status !== "DRAFT") {
    return { success: false, error: "Only draft orders can be submitted for review" };
  }

  try {
    await prisma.order.update({
      where: { id: orderId },
      data: { status: "AWAITING_REVIEW" },
    });

    return {
      success: true,
      order: {
        salesRepId: order.salesRepId,
        salesRepName: `${order.salesRep.firstName} ${order.salesRep.lastName}`,
      },
    };
  } catch (error) {
    console.error("Error submitting order for review:", error);
    return { success: false, error: "Failed to submit order for review" };
  }
}

/**
 * Decline an order
 * Moves order from AWAITING_REVIEW back to DRAFT
 */
export async function declineOrder(
  shopId: string,
  orderId: string
): Promise<{ success: true } | { success: false; error: string }> {
  const order = await prisma.order.findFirst({
    where: { id: orderId, shopId },
  });

  if (!order) {
    return { success: false, error: "Order not found" };
  }

  if (order.status !== "AWAITING_REVIEW") {
    return { success: false, error: "Only orders awaiting review can be declined" };
  }

  try {
    await prisma.order.update({
      where: { id: orderId },
      data: { status: "DRAFT" },
    });

    return { success: true };
  } catch (error) {
    console.error("Error declining order:", error);
    return { success: false, error: "Failed to decline order" };
  }
}

// =============================================================================
// Shopify Draft Order Integration
// =============================================================================

// GraphQL Mutations for Draft Orders
const DRAFT_ORDER_CREATE_MUTATION = `#graphql
  mutation DraftOrderCreate($input: DraftOrderInput!) {
    draftOrderCreate(input: $input) {
      draftOrder {
        id
        name
        invoiceUrl
        status
        totalPrice
        subtotalPrice
        totalTax
        currencyCode
        lineItems(first: 50) {
          edges {
            node {
              id
              title
              quantity
              originalUnitPrice
            }
          }
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const DRAFT_ORDER_UPDATE_MUTATION = `#graphql
  mutation DraftOrderUpdate($id: ID!, $input: DraftOrderInput!) {
    draftOrderUpdate(id: $id, input: $input) {
      draftOrder {
        id
        name
        status
        totalPrice
        subtotalPrice
        totalTax
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const DRAFT_ORDER_COMPLETE_MUTATION = `#graphql
  mutation DraftOrderComplete($id: ID!, $paymentPending: Boolean) {
    draftOrderComplete(id: $id, paymentPending: $paymentPending) {
      draftOrder {
        id
        order {
          id
          name
          totalPriceSet {
            shopMoney {
              amount
              currencyCode
            }
          }
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const DRAFT_ORDER_DELETE_MUTATION = `#graphql
  mutation DraftOrderDelete($input: DraftOrderDeleteInput!) {
    draftOrderDelete(input: $input) {
      deletedId
      userErrors {
        field
        message
      }
    }
  }
`;

const DRAFT_ORDER_QUERY = `#graphql
  query GetDraftOrder($id: ID!) {
    draftOrder(id: $id) {
      id
      name
      status
      invoiceUrl
      totalPrice
      subtotalPrice
      totalTax
      currencyCode
      order {
        id
        name
      }
      lineItems(first: 50) {
        edges {
          node {
            id
            title
            quantity
            originalUnitPrice
            variant {
              id
            }
            product {
              id
            }
          }
        }
      }
    }
  }
`;

const DRAFT_ORDER_INVOICE_SEND_MUTATION = `#graphql
  mutation DraftOrderInvoiceSend($id: ID!, $email: EmailInput) {
    draftOrderInvoiceSend(id: $id, email: $email) {
      draftOrder {
        id
        status
        invoiceUrl
        invoiceSentAt
      }
      userErrors {
        field
        message
      }
    }
  }
`;

// Complete draft order with a vaulted payment method
const DRAFT_ORDER_COMPLETE_WITH_PAYMENT_MUTATION = `#graphql
  mutation DraftOrderComplete($id: ID!, $paymentGatewayId: ID, $paymentPending: Boolean, $sourceName: String) {
    draftOrderComplete(id: $id, paymentGatewayId: $paymentGatewayId, paymentPending: $paymentPending, sourceName: $sourceName) {
      draftOrder {
        id
        order {
          id
          name
          displayFinancialStatus
          totalPriceSet {
            shopMoney {
              amount
              currencyCode
            }
          }
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

// Create order directly with payment method (alternative to draft order flow)
const ORDER_CREATE_MUTATION = `#graphql
  mutation OrderCreate($order: OrderCreateOrderInput!, $options: OrderCreateOptionsInput) {
    orderCreate(order: $order, options: $options) {
      order {
        id
        name
        displayFinancialStatus
      }
      userErrors {
        field
        message
      }
    }
  }
`;

// Query customer payment method with mandate information
const CUSTOMER_PAYMENT_METHOD_MANDATE_QUERY = `#graphql
  query GetPaymentMethodMandate($paymentMethodId: ID!) {
    customerPaymentMethod(id: $paymentMethodId) {
      id
      revokedAt
      instrument {
        ... on CustomerCreditCard {
          brand
          lastDigits
          expiryMonth
          expiryYear
        }
      }
      subscriptionContracts(first: 1) {
        edges {
          node {
            id
          }
        }
      }
    }
  }
`;

// Create mandate payment on an order (authorize or capture)
// autoCapture: true = capture immediately, false = authorize only
const ORDER_CREATE_MANDATE_PAYMENT_MUTATION = `#graphql
  mutation OrderCreateMandatePayment(
    $id: ID!
    $paymentMethodId: ID!
    $idempotencyKey: String!
    $autoCapture: Boolean
  ) {
    orderCreateMandatePayment(
      id: $id
      paymentMethodId: $paymentMethodId
      idempotencyKey: $idempotencyKey
      autoCapture: $autoCapture
    ) {
      job {
        id
        done
      }
      paymentReferenceId
      userErrors {
        field
        message
        code
      }
    }
  }
`;

// Capture an authorized payment on an order
const ORDER_CAPTURE_MUTATION = `#graphql
  mutation OrderCapture($input: OrderCaptureInput!) {
    orderCapture(input: $input) {
      transaction {
        id
        kind
        status
        amountSet {
          shopMoney {
            amount
            currencyCode
          }
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

// Types for Shopify admin API
interface ShopifyAdmin {
  graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response>;
}

interface DraftOrderLineItemInput {
  variantId?: string;
  title: string;
  quantity: number;
  originalUnitPrice: string;
  sku?: string;
  appliedDiscount?: {
    value: number;
    valueType: "FIXED_AMOUNT" | "PERCENTAGE";
    title?: string;
  };
}

// Sync local order to Shopify as Draft Order
export async function syncOrderToShopifyDraft(
  shopId: string,
  orderId: string,
  admin: ShopifyAdmin
): Promise<{ success: true; shopifyDraftOrderId: string } | { success: false; error: string }> {
  const order = await prisma.order.findFirst({
    where: { id: orderId, shopId },
    include: {
      company: {
        select: {
          shopifyCompanyId: true,
          name: true,
          territory: { select: { name: true, code: true } },
        },
      },
      contact: { select: { shopifyContactId: true, shopifyCustomerId: true, email: true, phone: true, firstName: true, lastName: true } },
      shippingLocation: {
        select: {
          shopifyLocationId: true,
          address1: true,
          address2: true,
          city: true,
          province: true,
          zipcode: true,
          countryCode: true,
          phone: true,
          territory: { select: { name: true, code: true } },
        },
      },
      billingLocation: { select: { shopifyLocationId: true, address1: true, address2: true, city: true, province: true, zipcode: true, countryCode: true, phone: true } },
      shippingMethod: { select: { title: true, priceCents: true } },
      salesRep: { select: { id: true, firstName: true, lastName: true, externalId: true } },
      lineItems: true,
    },
  });

  if (!order) {
    return { success: false, error: "Order not found" };
  }

  // Only AWAITING_REVIEW orders can be synced to Shopify (when being approved)
  // DRAFT orders must first be submitted for approval
  if (order.status !== "AWAITING_REVIEW") {
    return { success: false, error: "Only orders awaiting review can be submitted to Shopify" };
  }

  // Ensure metafield definitions exist for this shop (cached check)
  const metafieldSetup = await ensureMetafieldSetupForShop(shopId, admin);
  if (!metafieldSetup.success) {
    console.error("[Order Sync] Failed to ensure metafield definitions:", metafieldSetup.errors);
    // Don't fail the order - metafields are optional enhancement
  }

  // Validate that all product variants in the order still exist in Shopify
  const variantIds = order.lineItems
    .filter((li) => li.shopifyVariantId)
    .map((li) => li.shopifyVariantId as string);

  if (variantIds.length > 0) {
    const { validateOrderProductsWithShopify } = await import("./sync.server");
    const validation = await validateOrderProductsWithShopify(shopId, variantIds);

    if (!validation.valid) {
      const missingTitles = order.lineItems
        .filter((li) => validation.missingVariants.includes(li.shopifyVariantId || ""))
        .map((li) => li.title);

      return {
        success: false,
        error: `Some products no longer exist in Shopify: ${missingTitles.join(", ")}. Please edit the order and remove these items.`,
      };
    }
  }

  try {
    // Build line items for Shopify (convert numeric IDs to GIDs for GraphQL)
    // Include line item discounts if present
    const lineItems: DraftOrderLineItemInput[] = order.lineItems
      .filter((li) => !li.isPromotionItem) // Exclude free promo items, handle via discount
      .map((li) => {
        const lineItem: DraftOrderLineItemInput = {
          ...(li.shopifyVariantId && { variantId: toGid("ProductVariant", li.shopifyVariantId) }),
          title: li.title,
          quantity: li.quantity,
          originalUnitPrice: (li.unitPriceCents / 100).toFixed(2),
          ...(li.sku && { sku: li.sku }),
        };

        // Add line item discount if present
        if (li.discountCents > 0) {
          lineItem.appliedDiscount = {
            value: li.discountCents / 100,
            valueType: "FIXED_AMOUNT",
            title: li.promotionName || "Discount",
          };
        }

        return lineItem;
      });

    // Add free promotional items as $0 line items
    const promoItems = order.lineItems.filter((li) => li.isPromotionItem);
    for (const promoItem of promoItems) {
      lineItems.push({
        ...(promoItem.shopifyVariantId && { variantId: toGid("ProductVariant", promoItem.shopifyVariantId) }),
        title: promoItem.title,
        quantity: promoItem.quantity,
        originalUnitPrice: "0.00",
        ...(promoItem.sku && { sku: promoItem.sku }),
        appliedDiscount: {
          value: 100,
          valueType: "PERCENTAGE",
          title: promoItem.promotionName || "Free Item",
        },
      });
    }

    // Build shipping address if available
    const shippingAddress = order.shippingLocation
      ? {
          address1: order.shippingLocation.address1 || "",
          address2: order.shippingLocation.address2 || undefined,
          city: order.shippingLocation.city || "",
          province: order.shippingLocation.province || "",
          zip: order.shippingLocation.zipcode || "",
          country: order.shippingLocation.countryCode || "US",
          phone: order.shippingLocation.phone || undefined,
        }
      : undefined;

    // Build billing address if available
    const billingAddress = order.billingLocation
      ? {
          address1: order.billingLocation.address1 || "",
          address2: order.billingLocation.address2 || undefined,
          city: order.billingLocation.city || "",
          province: order.billingLocation.province || "",
          zip: order.billingLocation.zipcode || "",
          country: order.billingLocation.countryCode || "US",
          phone: order.billingLocation.phone || undefined,
        }
      : undefined;

    // Build sales rep name for attribution
    const salesRepName = order.salesRep
      ? `${order.salesRep.firstName} ${order.salesRep.lastName}`.trim()
      : undefined;

    // Get territory from shipping location first, fall back to company territory
    const territory = order.shippingLocation?.territory || order.company?.territory;

    // Build metafield data for this order
    const metafieldData: OrderMetafieldData = {
      territoryCode: territory?.code || null,
      territoryName: territory?.name || null,
      salesRepExternalId: order.salesRep?.externalId || null,
      salesRepName: salesRepName || null,
    };

    // Build metafields array for Shopify
    const metafields = buildOrderMetafields(metafieldData);

    // Build input for Shopify
    const input: Record<string, unknown> = {
      lineItems,
      tags: ["FieldSale"], // Tag for reporting and query filtering
      sourceName: "Field Sales App", // Attribution for reporting
      note: order.note || undefined,
      poNumber: order.poNumber || undefined,
      presentmentCurrencyCode: order.currency || "USD",
      ...(order.contact?.email && { email: order.contact.email }),
      ...(order.contact?.phone && { phone: order.contact.phone }),
      ...(shippingAddress && { shippingAddress }),
      ...(billingAddress && { billingAddress }),
      // Custom attributes for tracking sales rep who placed the order
      customAttributes: [
        { key: "salesRepId", value: order.salesRepId },
        ...(salesRepName ? [{ key: "salesRepName", value: salesRepName }] : []),
        { key: "fieldSalesOrderId", value: order.id },
      ],
      // App-specific metafields for reporting and integrations
      ...(metafields.length > 0 && { metafields }),
    };

    // Add shipping line if shipping method is selected
    if (order.shippingMethod) {
      input.shippingLine = {
        title: order.shippingMethod.title,
        price: (order.shippingMethod.priceCents / 100).toFixed(2),
      };
    }

    // Add order-level discount if present (ORDER_TOTAL promotions)
    // This is the total discount minus line item discounts
    const lineItemDiscountTotal = order.lineItems
      .filter((li) => !li.isPromotionItem)
      .reduce((sum, li) => sum + li.discountCents, 0);
    const orderLevelDiscount = order.discountCents - lineItemDiscountTotal;

    if (orderLevelDiscount > 0) {
      input.appliedDiscount = {
        value: orderLevelDiscount / 100,
        valueType: "FIXED_AMOUNT",
        title: "Order Discount",
      };
    }

    // Add B2B purchasing entity - prefer company location for B2B, fall back to customer
    if (order.company?.shopifyCompanyId && order.shippingLocation?.shopifyLocationId) {
      // B2B order with company location
      input.purchasingEntity = {
        purchasingCompany: {
          companyId: toGid("Company", order.company.shopifyCompanyId),
          companyLocationId: toGid("CompanyLocation", order.shippingLocation.shopifyLocationId),
          ...(order.contact?.shopifyContactId && {
            companyContactId: toGid("CompanyContact", order.contact.shopifyContactId),
          }),
        },
      };
    } else if (order.contact?.shopifyCustomerId) {
      // Fall back to customer if no B2B company
      input.purchasingEntity = {
        customerId: toGid("Customer", order.contact.shopifyCustomerId),
      };
    }

    let response: Response;
    let result: {
      data?: {
        draftOrderCreate?: {
          draftOrder?: { id: string };
          userErrors?: Array<{ field: string[]; message: string }>;
        };
        draftOrderUpdate?: {
          draftOrder?: { id: string };
          userErrors?: Array<{ field: string[]; message: string }>;
        };
      };
    };

    // If order already has a Shopify draft order ID, update it; otherwise create new
    if (order.shopifyDraftOrderId) {
      response = await admin.graphql(DRAFT_ORDER_UPDATE_MUTATION, {
        variables: { id: toGid("DraftOrder", order.shopifyDraftOrderId), input },
      });
      result = await response.json();

      if (result.data?.draftOrderUpdate?.userErrors?.length) {
        const errors = result.data.draftOrderUpdate.userErrors;
        console.error("Shopify draft order update errors:", errors);
        return { success: false, error: errors.map((e) => e.message).join(", ") };
      }

      return { success: true, shopifyDraftOrderId: order.shopifyDraftOrderId };
    } else {
      response = await admin.graphql(DRAFT_ORDER_CREATE_MUTATION, {
        variables: { input },
      });
      result = await response.json();

      if (result.data?.draftOrderCreate?.userErrors?.length) {
        const errors = result.data.draftOrderCreate.userErrors;
        console.error("Shopify draft order create errors:", errors);
        return { success: false, error: errors.map((e) => e.message).join(", ") };
      }

      const shopifyDraftOrderGid = result.data?.draftOrderCreate?.draftOrder?.id;
      if (!shopifyDraftOrderGid) {
        return { success: false, error: "Failed to create draft order in Shopify" };
      }

      // Extract numeric ID from GID for storage
      const shopifyDraftOrderId = fromGid(shopifyDraftOrderGid);

      // Update local order with Shopify draft order ID
      await prisma.order.update({
        where: { id: orderId },
        data: {
          shopifyDraftOrderId,
        },
      });

      return { success: true, shopifyDraftOrderId };
    }
  } catch (error) {
    console.error("Error syncing order to Shopify:", error);
    return { success: false, error: "Failed to sync order to Shopify" };
  }
}

// Complete a draft order in Shopify (convert to real order)
export async function completeDraftOrder(
  shopId: string,
  orderId: string,
  admin: ShopifyAdmin,
  paymentPending: boolean = false
): Promise<{ success: true; shopifyOrderId: string; shopifyOrderNumber: string } | { success: false; error: string }> {
  const order = await prisma.order.findFirst({
    where: { id: orderId, shopId },
  });

  if (!order) {
    return { success: false, error: "Order not found" };
  }

  if (!order.shopifyDraftOrderId) {
    return { success: false, error: "Order has not been synced to Shopify yet" };
  }

  if (order.status !== "PENDING") {
    return { success: false, error: "Only pending orders can be completed" };
  }

  try {
    const response = await admin.graphql(DRAFT_ORDER_COMPLETE_MUTATION, {
      variables: {
        id: toGid("DraftOrder", order.shopifyDraftOrderId),
        paymentPending,
      },
    });

    const result: {
      data?: {
        draftOrderComplete?: {
          draftOrder?: {
            order?: {
              id: string;
              name: string;
            };
          };
          userErrors?: Array<{ field: string[]; message: string }>;
        };
      };
    } = await response.json();

    if (result.data?.draftOrderComplete?.userErrors?.length) {
      const errors = result.data.draftOrderComplete.userErrors;
      console.error("Shopify draft order complete errors:", errors);
      return { success: false, error: errors.map((e) => e.message).join(", ") };
    }

    const shopifyOrder = result.data?.draftOrderComplete?.draftOrder?.order;
    if (!shopifyOrder) {
      return { success: false, error: "Failed to complete draft order in Shopify" };
    }

    // Extract numeric ID from GID for storage
    const shopifyOrderId = fromGid(shopifyOrder.id);

    // Update local order with Shopify order info
    await prisma.order.update({
      where: { id: orderId },
      data: {
        shopifyOrderId,
        shopifyOrderNumber: shopifyOrder.name,
        status: paymentPending ? "PENDING" : "PAID",
        placedAt: new Date(),
        ...(paymentPending ? {} : { paidAt: new Date() }),
      },
    });

    return {
      success: true,
      shopifyOrderId,
      shopifyOrderNumber: shopifyOrder.name,
    };
  } catch (error) {
    console.error("Error completing draft order:", error);
    return { success: false, error: "Failed to complete order in Shopify" };
  }
}

// Delete a draft order from Shopify
export async function deleteShopifyDraftOrder(
  shopId: string,
  orderId: string,
  admin: ShopifyAdmin
): Promise<{ success: true } | { success: false; error: string }> {
  const order = await prisma.order.findFirst({
    where: { id: orderId, shopId },
  });

  if (!order) {
    return { success: false, error: "Order not found" };
  }

  if (!order.shopifyDraftOrderId) {
    // No Shopify draft order to delete
    return { success: true };
  }

  if (order.shopifyOrderId) {
    return { success: false, error: "Cannot delete draft order that has been completed" };
  }

  try {
    const response = await admin.graphql(DRAFT_ORDER_DELETE_MUTATION, {
      variables: {
        input: { id: toGid("DraftOrder", order.shopifyDraftOrderId) },
      },
    });

    const result: {
      data?: {
        draftOrderDelete?: {
          deletedId?: string;
          userErrors?: Array<{ field: string[]; message: string }>;
        };
      };
    } = await response.json();

    if (result.data?.draftOrderDelete?.userErrors?.length) {
      const errors = result.data.draftOrderDelete.userErrors;
      console.error("Shopify draft order delete errors:", errors);
      return { success: false, error: errors.map((e) => e.message).join(", ") };
    }

    // Clear the Shopify draft order ID from local order
    await prisma.order.update({
      where: { id: orderId },
      data: {
        shopifyDraftOrderId: null,
        status: "DRAFT", // Revert to draft status
      },
    });

    return { success: true };
  } catch (error) {
    console.error("Error deleting Shopify draft order:", error);
    return { success: false, error: "Failed to delete draft order from Shopify" };
  }
}

// Payment options for order submission
export interface SubmitOrderOptions {
  // If provided, use this vaulted payment method (internal CUID from PaymentMethod table)
  paymentMethodId?: string;
  // If true, send invoice email (default behavior when no paymentMethodId and DUE_ON_ORDER)
  sendInvoice?: boolean;
}

// Payment status after approval
export type ApprovalPaymentStatus =
  | 'paid'              // DUE_ON_ORDER + card: authorized and captured
  | 'invoice_sent'      // DUE_ON_ORDER + no card: invoice emailed
  | 'authorized'        // DUE_ON_FULFILLMENT + card: card authorized, capture on fulfillment
  | 'pending_fulfillment' // DUE_ON_FULFILLMENT without card: pending until fulfillment
  | 'pending_receipt'   // DUE_ON_RECEIPT: pending until receipt
  | 'pending_net'       // NET_X: pending until due date
  | 'pending';          // Generic pending

// Authorize or capture payment on a Shopify order using a vaulted payment method
// autoCapture: true = authorize and capture immediately
// autoCapture: false = authorize only (capture on fulfillment)
async function processOrderPayment(
  shopifyOrderId: string,
  paymentMethodId: string, // Internal CUID from our PaymentMethod table
  admin: ShopifyAdmin,
  autoCapture: boolean
): Promise<{ success: true; paymentReferenceId?: string } | { success: false; error: string }> {
  try {
    // Look up the payment method to get the Shopify external ID
    const paymentMethod = await prisma.paymentMethod.findUnique({
      where: { id: paymentMethodId },
      select: { externalMethodId: true, isActive: true },
    });

    if (!paymentMethod) {
      return { success: false, error: "Payment method not found" };
    }

    if (!paymentMethod.isActive) {
      return { success: false, error: "Payment method is no longer active" };
    }

    // Convert to Shopify GID format
    const shopifyPaymentMethodGid = toGid("CustomerPaymentMethod", paymentMethod.externalMethodId);
    const shopifyOrderGid = toGid("Order", shopifyOrderId);

    // Generate unique idempotency key to prevent duplicate charges
    const idempotencyKey = `order_${shopifyOrderId}_payment_${Date.now()}`;

    const response = await admin.graphql(ORDER_CREATE_MANDATE_PAYMENT_MUTATION, {
      variables: {
        id: shopifyOrderGid,
        paymentMethodId: shopifyPaymentMethodGid,
        idempotencyKey,
        autoCapture,
      },
    });

    const result: {
      data?: {
        orderCreateMandatePayment?: {
          job?: { id: string; done: boolean };
          paymentReferenceId?: string;
          userErrors?: Array<{ field: string[]; message: string; code?: string }>;
        };
      };
    } = await response.json();

    if (result.data?.orderCreateMandatePayment?.userErrors?.length) {
      const errors = result.data.orderCreateMandatePayment.userErrors;
      console.error("Payment mandate errors:", errors);
      return { success: false, error: errors.map((e) => e.message).join(", ") };
    }

    const paymentReferenceId = result.data?.orderCreateMandatePayment?.paymentReferenceId;

    console.log(`Payment ${autoCapture ? 'captured' : 'authorized'} for order ${shopifyOrderId}:`, {
      paymentReferenceId,
      jobId: result.data?.orderCreateMandatePayment?.job?.id,
    });

    return { success: true, paymentReferenceId: paymentReferenceId || undefined };
  } catch (error) {
    console.error("Error processing payment:", error);
    return { success: false, error: "Failed to process payment" };
  }
}

// Submit order: sync to Shopify as Draft Order and handle payment based on terms
//
// Payment flow by terms:
// - DUE_ON_ORDER + card: complete order, then authorize and capture immediately
// - DUE_ON_ORDER + no card: send invoice
// - DUE_ON_FULFILLMENT + card: complete order, then authorize only (capture on fulfillment)
// - DUE_ON_FULFILLMENT + no card: complete with payment pending
// - DUE_ON_RECEIPT: complete with payment pending
// - NET_X: complete with payment pending, payment collected on due date
export async function submitOrderForPayment(
  shopId: string,
  orderId: string,
  admin: ShopifyAdmin,
  options: SubmitOrderOptions = {}
): Promise<{
  success: true;
  shopifyDraftOrderId: string;
  invoiceUrl?: string;
  shopifyOrderId?: string;
  shopifyOrderNumber?: string;
  paymentStatus: ApprovalPaymentStatus;
} | { success: false; error: string }> {
  const { paymentMethodId, sendInvoice = true } = options;

  // First, sync the order to Shopify (creates draft order)
  const syncResult = await syncOrderToShopifyDraft(shopId, orderId, admin);
  if (!syncResult.success) {
    return syncResult;
  }

  // Get the order with contact details and payment terms
  const order = await prisma.order.findFirst({
    where: { id: orderId, shopId },
    include: {
      contact: { select: { email: true, firstName: true, lastName: true, shopifyCustomerId: true } },
    },
  });

  if (!order) {
    return { success: false, error: "Order not found after sync" };
  }

  const paymentTerms = order.paymentTerms;
  const isDueOnOrder = paymentTerms === "DUE_ON_ORDER";
  const isDueOnFulfillment = paymentTerms === "DUE_ON_FULFILLMENT";
  const isDueOnReceipt = paymentTerms === "DUE_ON_RECEIPT";
  const isNetTerms = paymentTerms.startsWith("NET_");

  // ==========================================================================
  // DUE_ON_ORDER with card: Complete order, then authorize and capture
  // ==========================================================================
  if (isDueOnOrder && paymentMethodId) {
    try {
      // First, complete the draft order with payment pending
      // We'll charge via mandate payment after the order is created
      const response = await admin.graphql(DRAFT_ORDER_COMPLETE_MUTATION, {
        variables: {
          id: toGid("DraftOrder", syncResult.shopifyDraftOrderId),
          paymentPending: true, // Start as pending, we'll capture via mandate payment
        },
      });

      const result: {
        data?: {
          draftOrderComplete?: {
            draftOrder?: {
              order?: {
                id: string;
                name: string;
              };
            };
            userErrors?: Array<{ field: string[]; message: string }>;
          };
        };
      } = await response.json();

      if (result.data?.draftOrderComplete?.userErrors?.length) {
        const errors = result.data.draftOrderComplete.userErrors;
        console.error("Draft order complete errors:", errors);
        return { success: false, error: errors.map((e) => e.message).join(", ") };
      }

      const shopifyOrder = result.data?.draftOrderComplete?.draftOrder?.order;
      if (!shopifyOrder) {
        return { success: false, error: "Failed to complete order" };
      }

      const shopifyOrderId = fromGid(shopifyOrder.id);

      // Now authorize and capture the payment using the vaulted card
      const paymentResult = await processOrderPayment(
        shopifyOrderId,
        paymentMethodId,
        admin,
        true // autoCapture = true for DUE_ON_ORDER
      );

      if (!paymentResult.success) {
        // Order was created but payment failed - leave as pending
        console.error("Payment capture failed:", paymentResult.error);
        await prisma.order.update({
          where: { id: orderId },
          data: {
            status: "PENDING",
            shopifyOrderId,
            shopifyOrderNumber: shopifyOrder.name,
            paymentMethodId,
            placedAt: new Date(),
          },
        });
        return { success: false, error: `Order created but payment failed: ${paymentResult.error}` };
      }

      // Payment successful
      await prisma.order.update({
        where: { id: orderId },
        data: {
          status: "PAID",
          shopifyOrderId,
          shopifyOrderNumber: shopifyOrder.name,
          paymentMethodId,
          placedAt: new Date(),
          paidAt: new Date(),
        },
      });

      return {
        success: true,
        shopifyDraftOrderId: syncResult.shopifyDraftOrderId,
        shopifyOrderId,
        shopifyOrderNumber: shopifyOrder.name,
        paymentStatus: 'paid',
      };
    } catch (error) {
      console.error("Error completing order with payment:", error);
      return { success: false, error: "Failed to process payment" };
    }
  }

  // ==========================================================================
  // DUE_ON_FULFILLMENT with card: Complete order, then authorize only
  // Capture happens when order is fulfilled
  // ==========================================================================
  if (isDueOnFulfillment && paymentMethodId) {
    try {
      // Complete draft order with payment pending
      const response = await admin.graphql(DRAFT_ORDER_COMPLETE_MUTATION, {
        variables: {
          id: toGid("DraftOrder", syncResult.shopifyDraftOrderId),
          paymentPending: true,
        },
      });

      const result: {
        data?: {
          draftOrderComplete?: {
            draftOrder?: {
              order?: {
                id: string;
                name: string;
              };
            };
            userErrors?: Array<{ field: string[]; message: string }>;
          };
        };
      } = await response.json();

      if (result.data?.draftOrderComplete?.userErrors?.length) {
        const errors = result.data.draftOrderComplete.userErrors;
        console.error("Draft order complete errors:", errors);
        return { success: false, error: errors.map((e) => e.message).join(", ") };
      }

      const shopifyOrder = result.data?.draftOrderComplete?.draftOrder?.order;
      if (!shopifyOrder) {
        return { success: false, error: "Failed to complete order" };
      }

      const shopifyOrderId = fromGid(shopifyOrder.id);

      // Authorize the payment (hold on the card, capture on fulfillment)
      const paymentResult = await processOrderPayment(
        shopifyOrderId,
        paymentMethodId,
        admin,
        false // autoCapture = false for DUE_ON_FULFILLMENT (authorize only)
      );

      if (!paymentResult.success) {
        // Order was created but authorization failed
        console.error("Payment authorization failed:", paymentResult.error);
        // Still save the order but note the authorization failed
        await prisma.order.update({
          where: { id: orderId },
          data: {
            status: "PENDING",
            shopifyOrderId,
            shopifyOrderNumber: shopifyOrder.name,
            paymentMethodId,
            placedAt: new Date(),
          },
        });
        return { success: false, error: `Order created but authorization failed: ${paymentResult.error}` };
      }

      // Authorization successful
      await prisma.order.update({
        where: { id: orderId },
        data: {
          status: "PENDING", // Still pending until fulfillment and capture
          shopifyOrderId,
          shopifyOrderNumber: shopifyOrder.name,
          paymentMethodId,
          placedAt: new Date(),
        },
      });

      return {
        success: true,
        shopifyDraftOrderId: syncResult.shopifyDraftOrderId,
        shopifyOrderId,
        shopifyOrderNumber: shopifyOrder.name,
        paymentStatus: 'authorized',
      };
    } catch (error) {
      console.error("Error completing order:", error);
      return { success: false, error: "Failed to complete order" };
    }
  }

  // ==========================================================================
  // DUE_ON_RECEIPT, DUE_ON_FULFILLMENT (no card), or NET_X: Complete with payment pending
  // ==========================================================================
  if (isDueOnFulfillment || isDueOnReceipt || isNetTerms) {
    try {
      // Complete draft order with payment pending
      const response = await admin.graphql(DRAFT_ORDER_COMPLETE_MUTATION, {
        variables: {
          id: toGid("DraftOrder", syncResult.shopifyDraftOrderId),
          paymentPending: true,
        },
      });

      const result: {
        data?: {
          draftOrderComplete?: {
            draftOrder?: {
              order?: {
                id: string;
                name: string;
              };
            };
            userErrors?: Array<{ field: string[]; message: string }>;
          };
        };
      } = await response.json();

      if (result.data?.draftOrderComplete?.userErrors?.length) {
        const errors = result.data.draftOrderComplete.userErrors;
        console.error("Draft order complete errors:", errors);
        return { success: false, error: errors.map((e) => e.message).join(", ") };
      }

      const shopifyOrder = result.data?.draftOrderComplete?.draftOrder?.order;
      if (!shopifyOrder) {
        return { success: false, error: "Failed to complete order" };
      }

      const shopifyOrderId = fromGid(shopifyOrder.id);

      // Calculate payment due date for NET terms
      let paymentDueDate: Date | null = null;
      if (isNetTerms) {
        const days = parseInt(paymentTerms.replace("NET_", ""), 10);
        if (days > 0) {
          paymentDueDate = new Date();
          paymentDueDate.setDate(paymentDueDate.getDate() + days);
        }
      }

      await prisma.order.update({
        where: { id: orderId },
        data: {
          status: "PENDING",
          shopifyOrderId,
          shopifyOrderNumber: shopifyOrder.name,
          paymentMethodId: paymentMethodId || undefined, // Store if provided
          paymentDueDate,
          placedAt: new Date(),
        },
      });

      // Determine payment status
      let paymentStatus: ApprovalPaymentStatus = 'pending';
      if (isDueOnFulfillment) paymentStatus = 'pending_fulfillment';
      else if (isDueOnReceipt) paymentStatus = 'pending_receipt';
      else if (isNetTerms) paymentStatus = 'pending_net';

      return {
        success: true,
        shopifyDraftOrderId: syncResult.shopifyDraftOrderId,
        shopifyOrderId,
        shopifyOrderNumber: shopifyOrder.name,
        paymentStatus,
      };
    } catch (error) {
      console.error("Error completing order:", error);
      return { success: false, error: "Failed to complete order" };
    }
  }

  // ==========================================================================
  // DUE_ON_ORDER without card: Send invoice to customer
  // ==========================================================================
  try {
    let invoiceUrl = "";
    let invoiceSent = false;

    if (sendInvoice) {
      if (!order.contact?.email) {
        console.error("Cannot send invoice: No contact email for order", orderId);
        return { success: false, error: "Cannot send invoice: No contact email address" };
      }

      console.log(`Sending invoice for order ${order.orderNumber} to ${order.contact.email}`);

      const invoiceInput = {
        to: order.contact.email,
        subject: `Invoice for Order ${order.orderNumber}`,
        customMessage: order.note || undefined,
      };

      const response = await admin.graphql(DRAFT_ORDER_INVOICE_SEND_MUTATION, {
        variables: {
          id: toGid("DraftOrder", syncResult.shopifyDraftOrderId),
          email: invoiceInput,
        },
      });

      const result: {
        data?: {
          draftOrderInvoiceSend?: {
            draftOrder?: {
              id: string;
              invoiceUrl: string;
              invoiceSentAt: string;
            };
            userErrors?: Array<{ field: string[]; message: string }>;
          };
        };
      } = await response.json();

      if (result.data?.draftOrderInvoiceSend?.userErrors?.length) {
        const errors = result.data.draftOrderInvoiceSend.userErrors;
        console.error("Shopify invoice send errors:", errors);
        return { success: false, error: `Invoice send failed: ${errors.map(e => e.message).join(", ")}` };
      }

      invoiceUrl = result.data?.draftOrderInvoiceSend?.draftOrder?.invoiceUrl || "";
      invoiceSent = !!result.data?.draftOrderInvoiceSend?.draftOrder?.invoiceSentAt;

      console.log(`Invoice sent successfully. URL: ${invoiceUrl}, Sent: ${invoiceSent}`);
    }

    await prisma.order.update({
      where: { id: orderId },
      data: {
        status: "PENDING",
      },
    });

    return {
      success: true,
      shopifyDraftOrderId: syncResult.shopifyDraftOrderId,
      invoiceUrl,
      paymentStatus: sendInvoice && invoiceSent ? 'invoice_sent' : 'pending',
    };
  } catch (error) {
    console.error("Error sending invoice:", error);
    return { success: false, error: "Failed to send invoice" };
  }
}

// Get draft order status from Shopify
export async function getDraftOrderStatus(
  orderId: string,
  admin: ShopifyAdmin
): Promise<{ success: true; status: string; hasOrder: boolean; orderId?: string; orderName?: string } | { success: false; error: string }> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
  });

  if (!order) {
    return { success: false, error: "Order not found" };
  }

  if (!order.shopifyDraftOrderId) {
    return { success: false, error: "Order has not been synced to Shopify" };
  }

  try {
    const response = await admin.graphql(DRAFT_ORDER_QUERY, {
      variables: { id: toGid("DraftOrder", order.shopifyDraftOrderId) },
    });

    const result: {
      data?: {
        draftOrder?: {
          id: string;
          status: string;
          order?: {
            id: string;
            name: string;
          };
        };
      };
    } = await response.json();

    const draftOrder = result.data?.draftOrder;
    if (!draftOrder) {
      return { success: false, error: "Draft order not found in Shopify" };
    }

    return {
      success: true,
      status: draftOrder.status,
      hasOrder: !!draftOrder.order,
      orderId: draftOrder.order ? fromGid(draftOrder.order.id) : undefined,
      orderName: draftOrder.order?.name,
    };
  } catch (error) {
    console.error("Error fetching draft order status:", error);
    return { success: false, error: "Failed to fetch draft order status" };
  }
}

// Mark order as paid (after payment received)
export async function markOrderPaid(
  shopId: string,
  orderId: string
): Promise<{ success: true } | { success: false; error: string }> {
  const order = await prisma.order.findFirst({
    where: { id: orderId, shopId },
  });

  if (!order) {
    return { success: false, error: "Order not found" };
  }

  if (order.status === "CANCELLED" || order.status === "REFUNDED") {
    return { success: false, error: "Cannot mark cancelled or refunded order as paid" };
  }

  if (order.status === "PAID") {
    return { success: true }; // Already paid
  }

  try {
    await prisma.order.update({
      where: { id: orderId },
      data: {
        status: "PAID",
        paidAt: new Date(),
      },
    });

    // Record for billing revenue share (only if shop has active billing)
    const shop = await prisma.shop.findUnique({
      where: { id: shopId },
      select: { billingPlan: true, billingStatus: true },
    });

    if (shop?.billingPlan && (shop.billingStatus === "ACTIVE" || shop.billingStatus === "TRIAL")) {
      const billingPeriod = await getCurrentBillingPeriod(shopId);
      if (billingPeriod) {
        const planConfig = PLAN_CONFIGS[shop.billingPlan];
        await recordBilledOrder(orderId, billingPeriod.id, planConfig.revenueSharePercent);
      }
    }

    return { success: true };
  } catch (error) {
    console.error("Error marking order as paid:", error);
    return { success: false, error: "Failed to mark order as paid" };
  }
}

// =============================================================================
// Webhook Handlers
// =============================================================================

interface OrderWebhookPayload {
  id: number;
  admin_graphql_api_id: string;
  name: string;
  financial_status: string;
  source_name?: string;
  note_attributes?: Array<{ name: string; value: string }>;
}

interface DraftOrderWebhookPayload {
  id: number;
  admin_graphql_api_id: string;
  name: string;
  status: string;
  order_id?: number;
}

// Process ORDERS_CREATE or ORDERS_PAID webhook
// When a draft order is completed, Shopify creates an order - we need to link it
export async function processOrderWebhook(
  shopDomain: string,
  topic: string,
  payload: OrderWebhookPayload
): Promise<{ success: true } | { success: false; error: string }> {
  console.log(`[Order Webhook] Processing ${topic} for order ${payload.name}`);

  try {
    // Find shop with billing info
    const shop = await prisma.shop.findUnique({
      where: { shopifyDomain: shopDomain },
      select: {
        id: true,
        billingPlan: true,
        billingStatus: true,
      },
    });

    if (!shop) {
      console.log(`[Order Webhook] Shop not found: ${shopDomain}`);
      return { success: false, error: "Shop not found" };
    }

    // Extract numeric ID from GID for storage/lookup
    const shopifyOrderId = fromGid(payload.admin_graphql_api_id);

    // First, check if we already have an order linked to this Shopify order
    let order = await prisma.order.findFirst({
      where: { shopId: shop.id, shopifyOrderId },
    });

    if (order) {
      // Order already linked, update status based on webhook topic
      if (topic === "ORDERS_PAID" && order.status !== "PAID") {
        await prisma.order.update({
          where: { id: order.id },
          data: {
            status: "PAID",
            paidAt: new Date(),
          },
        });
        console.log(`[Order Webhook] Marked order ${order.orderNumber} as PAID`);

        // Record for billing revenue share
        if (shop.billingPlan && (shop.billingStatus === "ACTIVE" || shop.billingStatus === "TRIAL")) {
          const billingPeriod = await getCurrentBillingPeriod(shop.id);
          if (billingPeriod) {
            const planConfig = PLAN_CONFIGS[shop.billingPlan];
            await recordBilledOrder(order.id, billingPeriod.id, planConfig.revenueSharePercent);
            console.log(`[Order Webhook] Recorded billed order for revenue share`);
          }
        }
      } else if (topic === "ORDERS_CANCELLED" && order.status !== "CANCELLED") {
        await prisma.order.update({
          where: { id: order.id },
          data: {
            status: "CANCELLED",
            cancelledAt: new Date(),
          },
        });
        console.log(`[Order Webhook] Marked order ${order.orderNumber} as CANCELLED`);
      } else if (topic === "ORDERS_UPDATED" && payload.financial_status === "refunded" && order.status !== "REFUNDED") {
        await prisma.order.update({
          where: { id: order.id },
          data: {
            status: "REFUNDED",
            refundedAt: new Date(),
          },
        });
        console.log(`[Order Webhook] Marked order ${order.orderNumber} as REFUNDED`);
      }
      return { success: true };
    }

    // If order not found by shopifyOrderId, this might be a new order from a draft
    // Try to find by draft order ID pattern in note_attributes or source
    // Shopify doesn't directly give us the draft order ID in order webhook, so we need
    // to query orders that are PENDING and match by name/timing

    // For now, log and return success - manual linking may be needed
    // A better approach would be to use the draftOrderComplete response to link immediately
    console.log(`[Order Webhook] Order ${payload.name} not linked to local order`);

    return { success: true };
  } catch (error) {
    console.error("[Order Webhook] Error processing:", error);
    return { success: false, error: "Failed to process order webhook" };
  }
}

// Process DRAFT_ORDERS_UPDATE webhook
// When a draft order is completed (status changes to "completed"), it has an order_id
export async function processDraftOrderWebhook(
  shopDomain: string,
  topic: string,
  payload: DraftOrderWebhookPayload
): Promise<{ success: true } | { success: false; error: string }> {
  console.log(`[Draft Order Webhook] Processing ${topic} for draft ${payload.name}, status: ${payload.status}`);

  try {
    // Find shop with billing info
    const shop = await prisma.shop.findUnique({
      where: { shopifyDomain: shopDomain },
      select: {
        id: true,
        billingPlan: true,
        billingStatus: true,
      },
    });

    if (!shop) {
      console.log(`[Draft Order Webhook] Shop not found: ${shopDomain}`);
      return { success: false, error: "Shop not found" };
    }

    // Extract numeric ID from GID for storage/lookup
    const shopifyDraftOrderId = fromGid(payload.admin_graphql_api_id);

    // Find local order by draft order ID
    const order = await prisma.order.findFirst({
      where: { shopId: shop.id, shopifyDraftOrderId },
    });

    if (!order) {
      console.log(`[Draft Order Webhook] No local order found for draft ${payload.name}`);
      return { success: true };
    }

    // Check if draft order was completed (converted to real order)
    if (payload.status === "completed" && payload.order_id) {
      // Store numeric ID only (not full GID)
      const shopifyOrderId = String(payload.order_id);

      await prisma.order.update({
        where: { id: order.id },
        data: {
          shopifyOrderId,
          shopifyOrderNumber: payload.name?.replace("D", "") || null, // Draft #D1 -> Order #1
          status: "PAID", // Assuming payment was collected
          placedAt: new Date(),
          paidAt: new Date(),
        },
      });

      console.log(`[Draft Order Webhook] Linked order ${order.orderNumber} to Shopify order ${shopifyOrderId}`);

      // Record for billing revenue share
      if (shop.billingPlan && (shop.billingStatus === "ACTIVE" || shop.billingStatus === "TRIAL")) {
        const billingPeriod = await getCurrentBillingPeriod(shop.id);
        if (billingPeriod) {
          const planConfig = PLAN_CONFIGS[shop.billingPlan];
          await recordBilledOrder(order.id, billingPeriod.id, planConfig.revenueSharePercent);
          console.log(`[Draft Order Webhook] Recorded billed order for revenue share`);
        }
      }
    }

    return { success: true };
  } catch (error) {
    console.error("[Draft Order Webhook] Error processing:", error);
    return { success: false, error: "Failed to process draft order webhook" };
  }
}

// Mark order as refunded
export async function markOrderRefunded(
  shopId: string,
  orderId: string
): Promise<{ success: true } | { success: false; error: string }> {
  const order = await prisma.order.findFirst({
    where: { id: orderId, shopId },
  });

  if (!order) {
    return { success: false, error: "Order not found" };
  }

  if (order.status === "DRAFT" || order.status === "CANCELLED") {
    return { success: false, error: "Cannot refund draft or cancelled orders" };
  }

  if (order.status === "REFUNDED") {
    return { success: true }; // Already refunded
  }

  try {
    await prisma.order.update({
      where: { id: orderId },
      data: {
        status: "REFUNDED",
        refundedAt: new Date(),
      },
    });

    return { success: true };
  } catch (error) {
    console.error("Error marking order as refunded:", error);
    return { success: false, error: "Failed to mark order as refunded" };
  }
}

// =============================================================================
// Order Timeline
// =============================================================================

import type { AuthorType } from "@prisma/client";

// Event types for timeline
export type TimelineEventType =
  | "draft_created"
  | "submitted"
  | "approved"
  | "declined"
  | "cancelled"
  | "paid"
  | "refunded"
  | "comment"
  | "company_changed"
  | "contact_changed"
  | "shipping_location_changed"
  | "billing_location_changed"
  | "po_number_changed"
  | "note_changed"
  | "shipping_method_changed"
  | "payment_terms_changed"
  | "line_item_added"
  | "line_item_removed"
  | "line_item_quantity_changed"
  | "promotion_applied"
  | "promotion_removed";

export interface TimelineEventMetadata {
  // For changes
  oldValue?: string | number | null;
  newValue?: string | number | null;
  // For line items
  productTitle?: string;
  variantTitle?: string;
  quantity?: number;
  // For promotions
  promotionName?: string;
  // Generic
  [key: string]: unknown;
}

export interface OrderTimelineEventDetail {
  id: string;
  authorType: AuthorType;
  authorId: string | null;
  authorName: string;
  eventType: TimelineEventType;
  metadata: TimelineEventMetadata | null;
  comment: string | null;
  createdAt: string;
}

export interface CreateTimelineEventInput {
  orderId: string;
  authorType: AuthorType;
  authorId?: string | null;
  authorName: string;
  eventType: TimelineEventType;
  metadata?: TimelineEventMetadata | null;
  comment?: string | null;
}

/**
 * Get all timeline events for an order
 */
export async function getOrderTimeline(orderId: string): Promise<OrderTimelineEventDetail[]> {
  const events = await prisma.orderTimelineEvent.findMany({
    where: { orderId },
    orderBy: { createdAt: "asc" },
  });

  return events.map((e) => ({
    id: e.id,
    authorType: e.authorType,
    authorId: e.authorId,
    authorName: e.authorName,
    eventType: e.eventType as TimelineEventType,
    metadata: e.metadata as TimelineEventMetadata | null,
    comment: e.comment,
    createdAt: e.createdAt.toISOString(),
  }));
}

/**
 * Add a timeline event to an order
 */
export async function addTimelineEvent(
  input: CreateTimelineEventInput
): Promise<{ success: true; eventId: string } | { success: false; error: string }> {
  try {
    const event = await prisma.orderTimelineEvent.create({
      data: {
        orderId: input.orderId,
        authorType: input.authorType,
        authorId: input.authorId || null,
        authorName: input.authorName,
        eventType: input.eventType,
        metadata: input.metadata ? JSON.parse(JSON.stringify(input.metadata)) : undefined,
        comment: input.comment || null,
      },
    });

    return { success: true, eventId: event.id };
  } catch (error) {
    console.error("Error adding timeline event:", error);
    return { success: false, error: "Failed to add timeline event" };
  }
}

/**
 * Add a system timeline event (for automatic events)
 */
export async function addSystemTimelineEvent(
  orderId: string,
  eventType: TimelineEventType,
  metadata?: TimelineEventMetadata,
  message?: string
): Promise<void> {
  await prisma.orderTimelineEvent.create({
    data: {
      orderId,
      authorType: "SYSTEM",
      authorId: null,
      authorName: "System",
      eventType,
      metadata: metadata ? JSON.parse(JSON.stringify(metadata)) : undefined,
      comment: message || null,
    },
  });
}

/**
 * Helper to track changes between old and new order data
 * Only tracks changes for orders that are past DRAFT status
 */
export async function trackOrderChanges(
  orderId: string,
  orderStatus: OrderStatus,
  authorType: AuthorType,
  authorId: string | null,
  authorName: string,
  changes: {
    companyName?: { old: string | null; new: string | null };
    contactName?: { old: string | null; new: string | null };
    shippingLocationName?: { old: string | null; new: string | null };
    billingLocationName?: { old: string | null; new: string | null };
    poNumber?: { old: string | null; new: string | null };
    note?: { old: string | null; new: string | null };
    paymentTerms?: { old: string | null; new: string | null };
    lineItemsAdded?: Array<{ title: string; variantTitle?: string; quantity: number }>;
    lineItemsRemoved?: Array<{ title: string; variantTitle?: string; quantity: number }>;
    lineItemsQuantityChanged?: Array<{ title: string; variantTitle?: string; oldQty: number; newQty: number }>;
    promotionsApplied?: Array<{ name: string }>;
    promotionsRemoved?: Array<{ name: string }>;
  }
): Promise<void> {
  // Only track changes after order is submitted for review
  if (orderStatus === "DRAFT") {
    return;
  }

  const events: CreateTimelineEventInput[] = [];

  // Company changed
  if (changes.companyName && changes.companyName.old !== changes.companyName.new) {
    events.push({
      orderId,
      authorType,
      authorId,
      authorName,
      eventType: "company_changed",
      metadata: { oldValue: changes.companyName.old, newValue: changes.companyName.new },
    });
  }

  // Contact changed
  if (changes.contactName && changes.contactName.old !== changes.contactName.new) {
    events.push({
      orderId,
      authorType,
      authorId,
      authorName,
      eventType: "contact_changed",
      metadata: { oldValue: changes.contactName.old, newValue: changes.contactName.new },
    });
  }

  // Shipping location changed
  if (changes.shippingLocationName && changes.shippingLocationName.old !== changes.shippingLocationName.new) {
    events.push({
      orderId,
      authorType,
      authorId,
      authorName,
      eventType: "shipping_location_changed",
      metadata: { oldValue: changes.shippingLocationName.old, newValue: changes.shippingLocationName.new },
    });
  }

  // Billing location changed
  if (changes.billingLocationName && changes.billingLocationName.old !== changes.billingLocationName.new) {
    events.push({
      orderId,
      authorType,
      authorId,
      authorName,
      eventType: "billing_location_changed",
      metadata: { oldValue: changes.billingLocationName.old, newValue: changes.billingLocationName.new },
    });
  }

  // PO number changed
  if (changes.poNumber && changes.poNumber.old !== changes.poNumber.new) {
    events.push({
      orderId,
      authorType,
      authorId,
      authorName,
      eventType: "po_number_changed",
      metadata: { oldValue: changes.poNumber.old, newValue: changes.poNumber.new },
    });
  }

  // Note changed
  if (changes.note && changes.note.old !== changes.note.new) {
    events.push({
      orderId,
      authorType,
      authorId,
      authorName,
      eventType: "note_changed",
      metadata: { oldValue: changes.note.old, newValue: changes.note.new },
    });
  }

  // Payment terms changed
  if (changes.paymentTerms && changes.paymentTerms.old !== changes.paymentTerms.new) {
    events.push({
      orderId,
      authorType,
      authorId,
      authorName,
      eventType: "payment_terms_changed",
      metadata: { oldValue: changes.paymentTerms.old, newValue: changes.paymentTerms.new },
    });
  }

  // Line items added
  if (changes.lineItemsAdded) {
    for (const item of changes.lineItemsAdded) {
      events.push({
        orderId,
        authorType,
        authorId,
        authorName,
        eventType: "line_item_added",
        metadata: { productTitle: item.title, variantTitle: item.variantTitle, quantity: item.quantity },
      });
    }
  }

  // Line items removed
  if (changes.lineItemsRemoved) {
    for (const item of changes.lineItemsRemoved) {
      events.push({
        orderId,
        authorType,
        authorId,
        authorName,
        eventType: "line_item_removed",
        metadata: { productTitle: item.title, variantTitle: item.variantTitle, quantity: item.quantity },
      });
    }
  }

  // Line item quantities changed
  if (changes.lineItemsQuantityChanged) {
    for (const item of changes.lineItemsQuantityChanged) {
      events.push({
        orderId,
        authorType,
        authorId,
        authorName,
        eventType: "line_item_quantity_changed",
        metadata: { productTitle: item.title, variantTitle: item.variantTitle, oldValue: item.oldQty, newValue: item.newQty },
      });
    }
  }

  // Promotions applied
  if (changes.promotionsApplied) {
    for (const promo of changes.promotionsApplied) {
      events.push({
        orderId,
        authorType,
        authorId,
        authorName,
        eventType: "promotion_applied",
        metadata: { promotionName: promo.name },
      });
    }
  }

  // Promotions removed
  if (changes.promotionsRemoved) {
    for (const promo of changes.promotionsRemoved) {
      events.push({
        orderId,
        authorType,
        authorId,
        authorName,
        eventType: "promotion_removed",
        metadata: { promotionName: promo.name },
      });
    }
  }

  // Create all events
  if (events.length > 0) {
    await prisma.orderTimelineEvent.createMany({
      data: events.map((e) => ({
        orderId: e.orderId,
        authorType: e.authorType,
        authorId: e.authorId || null,
        authorName: e.authorName,
        eventType: e.eventType,
        metadata: e.metadata ? JSON.parse(JSON.stringify(e.metadata)) : undefined,
        comment: e.comment || null,
      })),
    });
  }
}
