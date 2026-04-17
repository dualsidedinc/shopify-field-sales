'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { OrderForm } from '@/components/orders/OrderForm';
import type { InitialOrderData, TimelineEvent as FormTimelineEvent } from '@/hooks/useOrderForm';
import type { OrderStatus } from '@field-sales/database';

interface OrderLineItem {
  id: string;
  shopifyProductId: string | null;
  shopifyVariantId: string | null;
  title: string;
  variantTitle: string | null;
  sku: string | null;
  imageUrl: string | null;
  quantity: number;
  unitPriceCents: number;
  discountCents: number;
  totalCents: number;
  // Promotion tracking
  isPromotionItem?: boolean;
  promotionId?: string | null;
  promotionName?: string | null;
}

interface TimelineEvent {
  id: string;
  authorType: string;
  authorId: string;
  authorName: string;
  eventType: string;
  metadata: unknown;
  comment: string | null;
  createdAt: string;
}

interface OrderCompany {
  id: string;
  name: string;
  shopifyCompanyId: string;
}

interface OrderContact {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
}

interface OrderLocation {
  id: string;
  name: string;
  address1: string;
  address2: string | null;
  city: string;
  province: string;
  zipcode: string;
  country: string;
}

interface OrderDetail {
  id: string;
  orderNumber: string;
  shopifyOrderId: string | null;
  shopifyOrderNumber: string | null;
  companyId: string;
  company: OrderCompany;
  companyName: string;
  contact: OrderContact | null;
  shippingLocation: OrderLocation | null;
  billingLocation: OrderLocation | null;
  shippingMethodId: string | null;
  appliedPromotionIds: string[];
  subtotalCents: number;
  discountCents: number;
  shippingCents: number;
  taxCents: number;
  totalCents: number;
  currency: string;
  status: string;
  paymentTerms: string;
  note: string | null;
  poNumber: string | null;
  placedAt: string | null;
  createdAt: string;
  rep: { name: string; email: string };
  territory: string | null;
  lineItems: OrderLineItem[];
  timelineEvents?: TimelineEvent[];
}

export default function OrderDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchOrder() {
      try {
        const { data, error: apiError } = await api.client.orders.get(id);

        if (apiError) {
          setError(apiError.message);
        } else {
          setOrder(data as unknown as OrderDetail);
        }
      } catch (err) {
        setError('Failed to load order');
        console.error('Error fetching order:', err);
      } finally {
        setLoading(false);
      }
    }

    fetchOrder();
  }, [id]);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Link href="/orders" className="min-w-touch min-h-touch flex items-center justify-center -ml-2">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <h1 className="text-xl font-bold text-gray-900">Loading...</h1>
        </div>
        <div className="card">
          <div className="animate-pulse space-y-4">
            <div className="h-4 bg-gray-200 rounded w-3/4"></div>
            <div className="h-4 bg-gray-200 rounded w-1/2"></div>
            <div className="h-20 bg-gray-200 rounded"></div>
          </div>
        </div>
      </div>
    );
  }

  if (error || !order) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Link href="/orders" className="min-w-touch min-h-touch flex items-center justify-center -ml-2">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <h1 className="text-xl font-bold text-gray-900">Error</h1>
        </div>
        <div className="card text-center py-8">
          <p className="text-red-500">{error || 'Order not found'}</p>
          <Link href="/orders" className="btn-secondary mt-4 inline-block">
            Back to Orders
          </Link>
        </div>
      </div>
    );
  }

  // Convert order to InitialOrderData format for the form
  const initialData: InitialOrderData = {
    company: {
      id: order.company.id,
      name: order.company.name,
      accountNumber: null,
      territoryName: order.territory,
    },
    contact: order.contact ? {
      id: order.contact.id,
      firstName: order.contact.firstName,
      lastName: order.contact.lastName,
      email: order.contact.email,
      phone: null,
      title: null,
      isPrimary: false,
    } : null,
    shippingLocation: order.shippingLocation ? {
      id: order.shippingLocation.id,
      name: order.shippingLocation.name,
      address1: order.shippingLocation.address1,
      address2: order.shippingLocation.address2,
      city: order.shippingLocation.city,
      province: order.shippingLocation.province,
      provinceCode: null,
      zipcode: order.shippingLocation.zipcode,
      country: order.shippingLocation.country,
      phone: null,
      isPrimary: false,
      isShippingAddress: true,
      isBillingAddress: false,
    } : null,
    billingLocation: order.billingLocation ? {
      id: order.billingLocation.id,
      name: order.billingLocation.name,
      address1: order.billingLocation.address1,
      address2: order.billingLocation.address2,
      city: order.billingLocation.city,
      province: order.billingLocation.province,
      provinceCode: null,
      zipcode: order.billingLocation.zipcode,
      country: order.billingLocation.country,
      phone: null,
      isPrimary: false,
      isShippingAddress: false,
      isBillingAddress: true,
    } : null,
    lineItems: order.lineItems.map((item) => ({
      id: item.id,
      shopifyProductId: item.shopifyProductId || '',
      shopifyVariantId: item.shopifyVariantId || '',
      sku: item.sku,
      title: item.title,
      variantTitle: item.variantTitle,
      imageUrl: item.imageUrl,
      quantity: item.quantity,
      unitPriceCents: item.unitPriceCents,
      basePriceCents: item.unitPriceCents, // Use unit price as base for existing orders
      discountCents: item.discountCents,
      totalCents: item.totalCents,
      // Promotion tracking - mark free items
      isFreeItem: item.isPromotionItem || false,
      promotionId: item.promotionId || undefined,
      promotionName: item.promotionName || undefined,
      // Quantity rules - not stored on existing orders, default to null
      quantityMin: null,
      quantityMax: null,
      quantityIncrement: null,
      priceBreaks: [],
    })),
    appliedPromotions: [], // Will be re-evaluated by form
    selectedShippingOption: order.shippingMethodId ? {
      id: order.shippingMethodId,
      title: 'Shipping',
      priceCents: order.shippingCents,
    } : null,
    note: order.note || '',
    poNumber: order.poNumber || '',
    subtotalCents: order.subtotalCents,
    discountCents: order.discountCents,
    shippingCents: order.shippingCents,
    taxCents: order.taxCents,
    totalCents: order.totalCents,
    currency: order.currency,
    status: order.status as OrderStatus,
    orderNumber: order.orderNumber,
    timelineEvents: (order.timelineEvents || []).map((event) => ({
      ...event,
      authorType: event.authorType as 'ADMIN' | 'SALES_REP' | 'SYSTEM',
    })) as FormTimelineEvent[],
  };

  return (
    <OrderForm
      mode="edit"
      orderId={id}
      initialData={initialData}
      onSuccess={() => {
        router.refresh();
      }}
    />
  );
}
