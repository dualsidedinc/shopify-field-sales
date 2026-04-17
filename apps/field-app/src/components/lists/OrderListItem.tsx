'use client';

import Link from 'next/link';
import { ChevronRight } from 'lucide-react';

export interface OrderListItemData {
  id: string;
  orderNumber: string;
  shopifyOrderNumber?: string | null;
  companyName: string;
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
}

function formatPrice(cents: number, currency: string = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(date);
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

function formatStatus(status: string): string {
  return status.split('_').map(word =>
    word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
  ).join(' ');
}

export function OrderListItem({ order, showDate = 'placed' }: OrderListItemProps) {
  const dateToShow = showDate === 'updated' && order.updatedAt
    ? order.updatedAt
    : showDate === 'created'
      ? order.createdAt
      : order.placedAt || order.createdAt;

  return (
    <Link
      href={`/orders/${order.id}`}
      className="flex items-center gap-3 px-3 py-2.5 hover:bg-gray-50 active:bg-gray-100 transition-colors"
    >
      <div className="flex-1 min-w-0">
        {/* Top row: Order # and Status */}
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm text-gray-900">
            {order.shopifyOrderNumber || order.orderNumber}
          </span>
          <span className={`${getStatusBadge(order.status)} text-[10px] px-1.5 py-0.5`}>
            {formatStatus(order.status)}
          </span>
        </div>
        {/* Bottom row: Company, Amount, Date */}
        <div className="flex items-center gap-1.5 mt-0.5">
          <span className="text-xs text-gray-600 truncate max-w-[140px]">
            {order.companyName}
          </span>
          <span className="text-gray-300">·</span>
          <span className="text-xs font-medium text-gray-900">
            {formatPrice(order.totalCents, order.currency)}
          </span>
          <span className="text-gray-300">·</span>
          <span className="text-xs text-gray-400">
            {formatDate(dateToShow)}
          </span>
        </div>
      </div>
      <ChevronRight className="w-4 h-4 text-gray-300 flex-shrink-0" />
    </Link>
  );
}

interface OrderListProps {
  orders: OrderListItemData[];
  loading?: boolean;
  emptyMessage?: string;
  emptySubMessage?: string;
  showDate?: 'placed' | 'created' | 'updated';
}

export function OrderList({
  orders,
  loading = false,
  emptyMessage = 'No orders found',
  emptySubMessage = 'Create your first order to get started',
  showDate = 'placed',
}: OrderListProps) {
  return (
    <div className="divide-y divide-gray-100 bg-white rounded-xl shadow-sm border border-gray-100">
      {loading ? (
        <div className="text-center py-8">
          <p className="text-gray-500 text-sm">Loading orders...</p>
        </div>
      ) : orders.length === 0 ? (
        <div className="text-center py-8">
          <p className="text-gray-500 text-sm">{emptyMessage}</p>
          <p className="text-xs text-gray-400 mt-1">{emptySubMessage}</p>
        </div>
      ) : (
        orders.map((order) => (
          <OrderListItem key={order.id} order={order} showDate={showDate} />
        ))
      )}
    </div>
  );
}
