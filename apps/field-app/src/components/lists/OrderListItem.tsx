'use client';

import Link from 'next/link';
import { getOrderStatusLabel } from '@/lib/orderStatus';

export interface OrderListItemData {
  id: string;
  orderNumber: string;
  shopifyOrderNumber?: string | null;
  companyName: string;
  /** Optional B2B account number, shown beneath the company name. */
  companyAccountNumber?: string | null;
  totalCents: number;
  currency: string;
  status: string;
  placedAt?: string | null;
  createdAt: string;
  updatedAt?: string;
}

interface OrderListItemProps {
  order: OrderListItemData;
  showDate?: 'placed' | 'created' | 'updated';
  /**
   * Hide company name + account number rows. Use this when the list lives
   * inside a company-scoped context (e.g. a company detail page) where the
   * company is already implied. Order number becomes the primary anchor.
   */
  hideCompany?: boolean;
}

function formatPrice(cents: number, currency: string = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
  }).format(cents / 100);
}

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();

  const time = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
    .format(date)
    .toLowerCase();

  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);

  if (sameDay(date, now)) return `Today at ${time}`;
  if (sameDay(date, yesterday)) return `Yesterday at ${time}`;

  const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays > 0 && diffDays < 7) {
    const day = new Intl.DateTimeFormat('en-US', { weekday: 'short' }).format(date);
    return `${day} at ${time}`;
  }

  const isSameYear = date.getFullYear() === now.getFullYear();
  if (isSameYear) {
    const monthDay = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(date);
    return `${monthDay} at ${time}`;
  }

  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
}

function getStatusBadge(status: string): string {
  const s = status.toLowerCase();
  if (s.includes('draft')) return 'badge-draft';
  if (s.includes('awaiting')) return 'badge-awaiting';
  if (s.includes('fulfilled') || s.includes('paid')) return 'badge-paid';
  if (s.includes('pending')) return 'badge-pending';
  if (s.includes('cancelled') || s.includes('refund')) return 'badge-cancelled';
  return 'badge-default';
}

const formatStatus = getOrderStatusLabel;

/**
 * Default mode: company name primary, account # secondary, order # subdued.
 * `hideCompany` mode: order # primary, date secondary — for use inside a
 * company-scoped list where the company would be redundant.
 */
export function OrderListItem({ order, showDate = 'placed', hideCompany = false }: OrderListItemProps) {
  const dateToShow =
    showDate === 'updated' && order.updatedAt
      ? order.updatedAt
      : showDate === 'created'
        ? order.createdAt
        : order.placedAt || order.createdAt;

  const orderNumber = order.shopifyOrderNumber || order.orderNumber;

  if (hideCompany) {
    return (
      <Link
        href={`/orders/${order.id}`}
        className="block px-4 py-3 hover:bg-gray-50 active:bg-gray-100 transition-colors"
      >
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="text-sm font-semibold text-gray-900 whitespace-nowrap">{orderNumber}</h3>
          <span className="text-sm font-semibold text-gray-900 whitespace-nowrap">
            {formatPrice(order.totalCents, order.currency)}
          </span>
        </div>
        <div className="flex items-center justify-between gap-3 mt-1">
          <span className="text-xs text-gray-500 truncate">{formatDate(dateToShow)}</span>
          <span className={`${getStatusBadge(order.status)} text-[10px] px-1.5 py-0.5 whitespace-nowrap`}>
            {formatStatus(order.status)}
          </span>
        </div>
      </Link>
    );
  }

  return (
    <Link
      href={`/orders/${order.id}`}
      className="block px-4 py-4 hover:bg-gray-50 active:bg-gray-100 transition-colors"
    >
      <div className="flex justify-between gap-3">
        <div className="flex-1 min-w-0">
          <h3 className="text-base font-semibold text-gray-900 truncate">{order.companyName}</h3>
          {order.companyAccountNumber && (
            <p className="text-sm text-gray-500 truncate mt-0.5">
              #{order.companyAccountNumber}
            </p>
          )}
          <p className="text-xs text-gray-400 truncate mt-1">
            {orderNumber} · {formatDate(dateToShow)}
          </p>
        </div>

        <div className="flex flex-col items-end gap-1 flex-shrink-0">
          <span className="text-base font-semibold text-gray-900 whitespace-nowrap">
            {formatPrice(order.totalCents, order.currency)}
          </span>
          <span className={`${getStatusBadge(order.status)} text-[10px] px-1.5 py-0.5 whitespace-nowrap`}>
            {formatStatus(order.status)}
          </span>
        </div>
      </div>
    </Link>
  );
}

interface OrderListProps {
  orders: OrderListItemData[];
  loading?: boolean;
  emptyMessage?: string;
  emptySubMessage?: string;
  showDate?: 'placed' | 'created' | 'updated';
  hideCompany?: boolean;
  /**
   * Render without the outer card chrome (no bg, no ring, no rounded).
   * Use this when the list lives inside another card so you don't get the
   * "card-in-card" effect. The caller supplies any outer styling.
   */
  bare?: boolean;
}

export function OrderList({
  orders,
  loading = false,
  emptyMessage = 'No orders found',
  emptySubMessage = 'Create your first order to get started',
  showDate = 'placed',
  hideCompany = false,
  bare = false,
}: OrderListProps) {
  const containerClass = bare
    ? 'divide-y divide-gray-100'
    : 'bg-white rounded-xl ring-1 ring-gray-200 overflow-hidden divide-y divide-gray-100';

  return (
    <div className={containerClass}>
      {loading ? (
        <div className="text-center py-8">
          <p className="text-gray-500 text-sm">Loading orders...</p>
        </div>
      ) : orders.length === 0 ? (
        <div className="text-center py-8">
          <p className="text-gray-500 text-sm">{emptyMessage}</p>
          {emptySubMessage && (
            <p className="text-xs text-gray-400 mt-1">{emptySubMessage}</p>
          )}
        </div>
      ) : (
        orders.map((order) => (
          <OrderListItem
            key={order.id}
            order={order}
            showDate={showDate}
            hideCompany={hideCompany}
          />
        ))
      )}
    </div>
  );
}
