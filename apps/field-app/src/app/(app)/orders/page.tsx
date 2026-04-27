'use client';

import { Suspense, useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Search, Plus } from 'lucide-react';
import { api } from '@/lib/api';
import { OrderList, type OrderListItemData } from '@/components/lists/OrderListItem';
import { PageHeader } from '@/components/ui';
import {
  ORDER_FILTER_KEYS,
  ORDER_FILTER_LABELS,
  filterToStatusParam,
  type OrderFilterKey,
} from '@/lib/orderStatus';

type StatusFilter = OrderFilterKey;

interface OrderApiItem {
  id: string;
  orderNumber: string;
  shopifyOrderId: string | null;
  shopifyOrderNumber: string | null;
  companyId: string;
  companyName: string;
  companyAccountNumber: string | null;
  contactName: string | null;
  locationAddress: string | null;
  totalCents: number;
  currency: string;
  status: string;
  placedAt: string | null;
  createdAt: string;
  repName: string;
}

const VALID_STATUS_FILTERS = ORDER_FILTER_KEYS;

function OrdersPageContent() {
  const searchParams = useSearchParams();
  const initialStatus = searchParams.get('status') as StatusFilter | null;
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(
    initialStatus && VALID_STATUS_FILTERS.includes(initialStatus) ? initialStatus : 'all'
  );
  const [orders, setOrders] = useState<OrderApiItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [totalCount, setTotalCount] = useState(0);
  const initialLoad = useRef(true);

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Reset to page 1 when filters change
  useEffect(() => {
    if (!initialLoad.current) {
      setPage(1);
      setOrders([]);
    }
    initialLoad.current = false;
  }, [debouncedSearch, statusFilter]);

  const fetchOrders = useCallback(async (pageNum: number, append: boolean = false) => {
    if (append) {
      setLoadingMore(true);
    } else {
      setLoading(true);
    }

    try {
      const { data } = await api.client.orders.list({
        page: pageNum,
        pageSize: 30,
        query: debouncedSearch || undefined,
        status: filterToStatusParam(statusFilter),
      });

      if (data) {
        if (append) {
          setOrders(prev => [...prev, ...(data.items as unknown as OrderApiItem[])]);
        } else {
          setOrders(data.items as unknown as OrderApiItem[]);
        }
        setHasMore(data.pagination.hasNextPage);
        setTotalCount(data.pagination.totalItems);
      }
    } catch (error) {
      console.error('Error fetching orders:', error);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [debouncedSearch, statusFilter]);

  useEffect(() => {
    fetchOrders(page, page > 1);
  }, [page, fetchOrders]);

  const loadMore = () => {
    if (!loadingMore && hasMore) {
      setPage(prev => prev + 1);
    }
  };

  // Convert to shared component format
  const orderListData: OrderListItemData[] = orders.map((o) => ({
    id: o.id,
    orderNumber: o.orderNumber,
    shopifyOrderNumber: o.shopifyOrderNumber,
    companyName: o.companyName,
    companyAccountNumber: o.companyAccountNumber,
    totalCents: o.totalCents,
    currency: o.currency,
    status: o.status,
    placedAt: o.placedAt,
    createdAt: o.createdAt,
  }));

  const filterLabels = ORDER_FILTER_LABELS;

  return (
    <div>
      <PageHeader
        title="Orders"
        action={
          <Link
            href="/orders/create"
            className="inline-flex items-center gap-1.5 h-9 px-3 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 active:bg-gray-100 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Create order
          </Link>
        }
      />

      <div className="space-y-3">
        {/* Unified toolbar: filter + search in a single white shell */}
        <div className="flex bg-white rounded-lg ring-1 ring-gray-200 overflow-hidden">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            aria-label="Filter by status"
            className="h-11 text-sm bg-transparent pl-3 pr-8 text-gray-900 font-medium focus:outline-none focus:ring-2 focus:ring-inset focus:ring-primary-500 appearance-none cursor-pointer border-r border-gray-200"
            style={{
              backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%236B7280'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M19 9l-7 7-7-7'%3E%3C/path%3E%3C/svg%3E")`,
              backgroundRepeat: 'no-repeat',
              backgroundPosition: 'right 8px center',
              backgroundSize: '14px',
            }}
          >
            {ORDER_FILTER_KEYS.map((status) => (
              <option key={status} value={status}>
                {filterLabels[status]}
              </option>
            ))}
          </select>

          <div className="relative flex-1 min-w-0">
            <input
              type="search"
              placeholder="Search orders..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full h-11 pl-9 pr-3 text-sm bg-transparent text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-primary-500"
            />
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
          </div>
        </div>

        {/* Results count */}
      {!loading && totalCount > 0 && (
        <p className="text-xs text-gray-500 px-1">
          {totalCount} order{totalCount !== 1 ? 's' : ''}
          {debouncedSearch && ` matching "${debouncedSearch}"`}
        </p>
      )}

      {/* Order List */}
      <OrderList
        orders={orderListData}
        loading={loading}
        emptyMessage="No orders found"
        emptySubMessage={
          debouncedSearch || statusFilter !== 'all'
            ? 'Try adjusting your filters'
            : 'Create your first order to get started'
        }
      />

        {/* Load More */}
        {hasMore && !loading && (
          <button
            onClick={loadMore}
            disabled={loadingMore}
            className="btn-secondary w-full text-sm py-2"
          >
            {loadingMore ? 'Loading...' : `Load more (${orders.length} of ${totalCount})`}
          </button>
        )}
      </div>
    </div>
  );
}

export default function OrdersPage() {
  return (
    <Suspense fallback={<div className="p-4 text-center text-gray-500">Loading...</div>}>
      <OrdersPageContent />
    </Suspense>
  );
}
