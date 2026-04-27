/**
 * Single source of truth for user-facing order status labels and filter
 * groupings. Kept in `lib/` so list, form, and badge components all render
 * the same wording.
 *
 * Underlying enum (DB): DRAFT, AWAITING_REVIEW, PENDING, PAID, CANCELLED, REFUNDED
 * Surface labels:       Draft, In Review,        Processing, Paid, Cancelled, Refunded
 *
 * The filter dropdown collapses CANCELLED + REFUNDED into a single
 * "Cancelled" choice. Badges still show "Refunded" specifically so reps
 * don't lose the distinction at the order level.
 */

export const ORDER_STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Draft',
  AWAITING_REVIEW: 'In Review',
  PENDING: 'Processing',
  PAID: 'Paid',
  CANCELLED: 'Cancelled',
  REFUNDED: 'Refunded',
};

export function getOrderStatusLabel(status: string): string {
  return (
    ORDER_STATUS_LABELS[status] ??
    status
      .split('_')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(' ')
  );
}

// Filter dropdown options for the orders list page.
export type OrderFilterKey =
  | 'all'
  | 'DRAFT'
  | 'AWAITING_REVIEW'
  | 'PENDING'
  | 'PAID'
  | 'CANCELLED';

export const ORDER_FILTER_KEYS: OrderFilterKey[] = [
  'all',
  'DRAFT',
  'AWAITING_REVIEW',
  'PENDING',
  'PAID',
  'CANCELLED',
];

export const ORDER_FILTER_LABELS: Record<OrderFilterKey, string> = {
  all: 'All',
  DRAFT: 'Draft',
  AWAITING_REVIEW: 'In Review',
  PENDING: 'Processing',
  PAID: 'Paid',
  CANCELLED: 'Cancelled',
};

/**
 * Maps a UI filter choice to the comma-separated underlying status values
 * the API understands. Returns `undefined` for the "all" option.
 */
export function filterToStatusParam(filter: OrderFilterKey): string | undefined {
  if (filter === 'all') return undefined;
  if (filter === 'CANCELLED') return 'CANCELLED,REFUNDED';
  return filter;
}
