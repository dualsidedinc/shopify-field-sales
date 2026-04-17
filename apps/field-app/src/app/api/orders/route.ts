import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { getAuthContext } from '@/lib/auth';
import { evaluatePromotions } from '@/services/promotions';
import type { CartLineItem as PromotionCartLineItem } from '@/services/promotions';
import type { ApiError, CartLineItem } from '@/types';

interface LineItemInput {
  shopifyProductId: string;
  shopifyVariantId: string;
  sku: string | null;
  title: string;
  variantTitle: string | null;
  imageUrl?: string | null;
  quantity: number;
  unitPriceCents: number;
  isFreeItem?: boolean;
  promotionId?: string | null;
  promotionName?: string | null;
}

interface CreateOrderRequest {
  companyId: string;
  contactId?: string;
  shippingLocationId?: string;
  billingLocationId?: string;
  lineItems?: LineItemInput[];
  appliedPromotionIds?: string[];
  shippingMethodId?: string;
  note?: string | null;
  poNumber?: string | null;
  subtotalCents?: number;
  discountCents?: number;
  shippingCents?: number;
  taxCents?: number;
  totalCents?: number;
  currency?: string;
  submitForApproval?: boolean;
  comment?: string;
}

export async function GET(request: Request) {
  try {
    const { shopId, repId, role } = await getAuthContext();
    const { searchParams } = new URL(request.url);

    const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
    const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get('pageSize') || '20')));
    const companyId = searchParams.get('companyId');
    const status = searchParams.get('status');
    const query = searchParams.get('query')?.trim();

    const skip = (page - 1) * pageSize;

    // Build where clause with search and filters
    const where = {
      shopId,
      deletedAt: null, // Exclude soft-deleted orders
      ...(role === 'REP' && { salesRepId: repId }),
      ...(companyId && { companyId }),
      ...(status && { status: status as 'DRAFT' | 'AWAITING_REVIEW' | 'PENDING' | 'PAID' | 'REFUNDED' }),
      // Search by order number or company name
      ...(query && {
        OR: [
          { orderNumber: { contains: query, mode: 'insensitive' as const } },
          { shopifyOrderNumber: { contains: query, mode: 'insensitive' as const } },
          { company: { name: { contains: query, mode: 'insensitive' as const } } },
          { poNumber: { contains: query, mode: 'insensitive' as const } },
        ],
      }),
    };

    const [orders, totalItems] = await Promise.all([
      prisma.order.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        include: {
          salesRep: { select: { firstName: true, lastName: true } },
          company: { select: { name: true } },
          contact: { select: { firstName: true, lastName: true } },
          shippingLocation: {
            select: {
              name: true,
              address1: true,
              city: true,
              provinceCode: true,
              zipcode: true,
            },
          },
        },
      }),
      prisma.order.count({ where }),
    ]);

    const items = orders.map((o) => {
      // Format location address
      let locationAddress: string | null = null;
      if (o.shippingLocation) {
        const loc = o.shippingLocation;
        const parts = [loc.address1, loc.city, loc.provinceCode, loc.zipcode].filter(Boolean);
        locationAddress = parts.join(', ') || loc.name;
      }

      return {
        id: o.id,
        orderNumber: o.orderNumber,
        shopifyOrderId: o.shopifyOrderId,
        shopifyOrderNumber: o.shopifyOrderNumber,
        companyId: o.companyId,
        companyName: o.company.name,
        contactName: o.contact ? `${o.contact.firstName} ${o.contact.lastName}` : null,
        locationAddress,
        totalCents: o.totalCents,
        currency: o.currency,
        status: o.status,
        placedAt: o.placedAt,
        createdAt: o.createdAt,
        repName: `${o.salesRep.firstName} ${o.salesRep.lastName}`,
      };
    });

    const totalPages = Math.ceil(totalItems / pageSize);

    return NextResponse.json({
      data: {
        items,
        pagination: {
          page,
          pageSize,
          totalItems,
          totalPages,
          hasNextPage: page < totalPages,
          hasPreviousPage: page > 1,
        },
      },
      error: null,
    });
  } catch (error) {
    console.error('Error fetching orders:', error);
    return NextResponse.json<ApiError>(
      { data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch orders' } },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const { shopId, repId } = await getAuthContext();
    const body = (await request.json()) as CreateOrderRequest;

    if (!body.companyId) {
      return NextResponse.json<ApiError>(
        { data: null, error: { code: 'VALIDATION_ERROR', message: 'Company ID is required' } },
        { status: 400 }
      );
    }

    // Use lineItems from request body if provided, otherwise look for cart session
    let lineItemsToProcess: LineItemInput[] = [];
    let cartId: string | null = null;
    let cartNotes: string | null = null;

    if (body.lineItems && body.lineItems.length > 0) {
      // Use lineItems from request body
      lineItemsToProcess = body.lineItems;
    } else {
      // Fall back to cart session
      const cart = await prisma.cartSession.findFirst({
        where: {
          shopId,
          repId,
          companyId: body.companyId,
          status: 'ACTIVE',
        },
      });

      if (!cart) {
        return NextResponse.json<ApiError>(
          { data: null, error: { code: 'NOT_FOUND', message: 'No active cart found' } },
          { status: 404 }
        );
      }

      const cartLineItems = (cart.lineItems ?? []) as unknown as CartLineItem[];

      if (cartLineItems.length === 0) {
        return NextResponse.json<ApiError>(
          { data: null, error: { code: 'VALIDATION_ERROR', message: 'Cart is empty' } },
          { status: 400 }
        );
      }

      cartId = cart.id;
      cartNotes = cart.notes;

      // Convert cart line items to the same format
      lineItemsToProcess = cartLineItems.map((item) => ({
        shopifyProductId: item.productId,
        shopifyVariantId: item.variantId,
        sku: item.sku || null,
        title: item.title,
        variantTitle: item.variantTitle || null,
        quantity: item.quantity,
        unitPriceCents: Math.round(parseFloat(item.price) * 100),
      }));
    }

    if (lineItemsToProcess.length === 0) {
      return NextResponse.json<ApiError>(
        { data: null, error: { code: 'VALIDATION_ERROR', message: 'No line items provided' } },
        { status: 400 }
      );
    }

    // Get company and sales rep info
    const [company, salesRep] = await Promise.all([
      prisma.company.findFirst({
        where: { id: body.companyId, shopId },
      }),
      prisma.salesRep.findUnique({
        where: { id: repId },
        select: { approvalThresholdCents: true },
      }),
    ]);

    if (!company) {
      return NextResponse.json<ApiError>(
        { data: null, error: { code: 'NOT_FOUND', message: 'Company not found' } },
        { status: 404 }
      );
    }

    // Check if line items already include free items (from form)
    // If so, use them directly; otherwise evaluate promotions
    const hasFreeItems = lineItemsToProcess.some((item) => item.isFreeItem);

    // Prepare line items for saving - use provided data directly if includes free items
    let finalLineItems: Array<{
      shopifyProductId: string;
      shopifyVariantId: string;
      sku: string | null;
      title: string;
      variantTitle: string | null;
      imageUrl: string | null;
      quantity: number;
      unitPriceCents: number;
      discountCents: number;
      totalCents: number;
      isPromotionItem: boolean;
      promotionId: string | null;
      promotionName: string | null;
    }>;
    let appliedPromotionIds: string[] = body.appliedPromotionIds || [];

    if (hasFreeItems) {
      // Use line items directly from request (includes free items with correct titles)
      finalLineItems = lineItemsToProcess.map((item) => ({
        shopifyProductId: item.shopifyProductId,
        shopifyVariantId: item.shopifyVariantId,
        sku: item.sku,
        title: item.title,
        variantTitle: item.variantTitle,
        imageUrl: item.imageUrl || null,
        quantity: item.quantity,
        unitPriceCents: item.unitPriceCents,
        discountCents: item.isFreeItem ? item.unitPriceCents * item.quantity : 0,
        totalCents: item.isFreeItem ? 0 : item.unitPriceCents * item.quantity,
        isPromotionItem: item.isFreeItem || false,
        promotionId: item.promotionId || null,
        promotionName: item.promotionName || null,
      }));
    } else {
      // No free items in request - evaluate promotions (cart session flow)
      const shopifyVariantIds = lineItemsToProcess.map((item) => item.shopifyVariantId);
      const localVariants = await prisma.productVariant.findMany({
        where: {
          shopifyVariantId: { in: shopifyVariantIds },
          product: { shopId },
        },
        include: {
          product: { select: { id: true, shopifyProductId: true } },
        },
      });

      const variantMap = new Map(
        localVariants.map((v) => [v.shopifyVariantId, v])
      );

      const promotionLineItems: PromotionCartLineItem[] = lineItemsToProcess.map((item) => {
        const localVariant = variantMap.get(item.shopifyVariantId);
        return {
          variantId: localVariant?.id || item.shopifyVariantId,
          shopifyVariantId: item.shopifyVariantId,
          productId: localVariant?.product.id || item.shopifyProductId,
          shopifyProductId: localVariant?.product.shopifyProductId || item.shopifyProductId,
          title: item.title,
          variantTitle: item.variantTitle,
          quantity: item.quantity,
          unitPriceCents: item.unitPriceCents,
        };
      });

      const promoResult = await evaluatePromotions(shopId, promotionLineItems);
      appliedPromotionIds = promoResult.appliedPromotions.map((p) => p.id);

      finalLineItems = promoResult.lineItems.map((item) => {
        const originalItem = lineItemsToProcess.find((c) => c.shopifyVariantId === item.shopifyVariantId);
        const promotion = item.isFreeItem
          ? promoResult.appliedPromotions.find((p) => p.id === item.promotionId)
          : null;

        return {
          shopifyProductId: item.shopifyProductId,
          shopifyVariantId: item.shopifyVariantId,
          sku: originalItem?.sku || null,
          title: item.title,
          variantTitle: item.variantTitle,
          imageUrl: originalItem?.imageUrl || null,
          quantity: item.quantity,
          unitPriceCents: item.unitPriceCents,
          discountCents: item.totalDiscountCents,
          totalCents: item.finalPriceCents,
          isPromotionItem: item.isFreeItem || false,
          promotionId: item.promotionId || null,
          promotionName: promotion?.name || null,
        };
      });
    }

    // Generate internal order number (find highest existing and increment)
    const existingOrders = await prisma.order.findMany({
      where: { shopId },
      select: { orderNumber: true },
    });

    let maxNumber = 0;
    for (const order of existingOrders) {
      if (order.orderNumber) {
        // Extract number from format like "FS-000001" or "FS-1000"
        const match = order.orderNumber.match(/FS-(\d+)/);
        if (match) {
          const num = parseInt(match[1], 10);
          if (num > maxNumber) {
            maxNumber = num;
          }
        }
      }
    }
    const orderNumber = `FS-${maxNumber + 1}`;

    // Calculate totals from line items if not provided
    const regularItems = finalLineItems.filter((item) => !item.isPromotionItem);
    const calculatedSubtotal = regularItems.reduce(
      (sum, item) => sum + item.unitPriceCents * item.quantity,
      0
    );
    const subtotalForApproval = body.subtotalCents ?? calculatedSubtotal;

    // Determine if order needs approval based on rep's threshold
    // null = no approval needed (trusted rep)
    // 0 = all orders need approval
    // > 0 = orders with subtotal >= threshold need approval
    const needsApproval = salesRep?.approvalThresholdCents !== null &&
      salesRep?.approvalThresholdCents !== undefined &&
      subtotalForApproval >= salesRep.approvalThresholdCents;

    // Determine order status
    // - If submitForApproval is true AND approval is required, set to AWAITING_REVIEW
    // - If submitForApproval is true AND approval is NOT required, skip to PENDING
    // - Otherwise, stay as DRAFT
    let orderStatus: 'DRAFT' | 'AWAITING_REVIEW' | 'PENDING' = 'DRAFT';
    if (body.submitForApproval) {
      orderStatus = needsApproval ? 'AWAITING_REVIEW' : 'PENDING';
    }

    // Save order to database (shopify-app will sync to Shopify)
    const order = await prisma.order.create({
      data: {
        shopId,
        salesRepId: repId,
        companyId: body.companyId,
        contactId: body.contactId || null,
        shippingLocationId: body.shippingLocationId || null,
        billingLocationId: body.billingLocationId || null,
        orderNumber,
        // Shopify IDs will be populated by shopify-app after sync
        shopifyDraftOrderId: null,
        shopifyOrderId: null,
        shopifyOrderNumber: null,
        subtotalCents: body.subtotalCents ?? calculatedSubtotal,
        discountCents: body.discountCents ?? 0,
        shippingCents: body.shippingCents ?? 0,
        taxCents: body.taxCents ?? 0,
        totalCents: body.totalCents ?? calculatedSubtotal,
        appliedPromotionIds,
        currency: body.currency ?? 'USD',
        status: orderStatus,
        paymentTerms: company.paymentTerms,
        note: body.note ?? cartNotes,
        poNumber: body.poNumber ?? null,
        shippingMethodId: body.shippingMethodId ?? null,
        placedAt: new Date(),
        // Create line items with discount info (including free items from promotions)
        lineItems: {
          create: finalLineItems.map((item) => ({
            shopifyProductId: item.shopifyProductId,
            shopifyVariantId: item.shopifyVariantId,
            sku: item.sku,
            title: item.title,
            variantTitle: item.variantTitle,
            imageUrl: item.imageUrl,
            quantity: item.quantity,
            unitPriceCents: item.unitPriceCents,
            discountCents: item.discountCents,
            taxCents: 0,
            totalCents: item.totalCents,
            isPromotionItem: item.isPromotionItem,
            promotionId: item.promotionId,
            promotionName: item.promotionName,
          })),
        },
      },
      include: {
        lineItems: true,
      },
    });

    // Mark cart as submitted if we used a cart session
    if (cartId) {
      await prisma.cartSession.update({
        where: { id: cartId },
        data: { status: 'SUBMITTED' },
      });
    }

    return NextResponse.json({
      data: {
        id: order.id,
        orderNumber: order.orderNumber,
        shopifyOrderId: order.shopifyOrderId,
        shopifyOrderNumber: order.shopifyOrderNumber,
        subtotalCents: order.subtotalCents,
        discountCents: order.discountCents,
        totalCents: order.totalCents,
        status: order.status,
        appliedPromotionIds,
        lineItems: finalLineItems.map((item) => ({
          title: item.title,
          quantity: item.quantity,
          unitPriceCents: item.unitPriceCents,
          discountCents: item.discountCents,
          totalCents: item.totalCents,
        })),
      },
      error: null,
    }, { status: 201 });
  } catch (error) {
    console.error('Error creating order:', error);
    return NextResponse.json<ApiError>(
      {
        data: null,
        error: {
          code: 'INTERNAL_ERROR',
          message: error instanceof Error ? error.message : 'Failed to create order',
        },
      },
      { status: 500 }
    );
  }
}
