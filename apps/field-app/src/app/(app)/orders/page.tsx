'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { Search, Plus } from 'lucide-react';
import { api } from '@/lib/api';
import { OrderList, type OrderListItemData } from '@/components/lists/OrderListItem';

type StatusFilter = 'all' | 'DRAFT' | 'AWAITING_REVIEW' | 'PENDING' | 'PAID' | 'REFUNDED';

interface OrderApiItem {
  id: string;
  orderNumber: string;
  shopifyOrderId: string | null;
  shopifyOrderNumber: string | null;
  companyId: string;
  companyName: string;
  contactName: string | null;
  locationAddress: string | null;
  totalCents: number;
  currency: string;
  status: string;
  placedAt: string | null;
  createdAt: string;
  repName: string;
}

export default function OrdersPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
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
        status: statusFilter !== 'all' ? statusFilter : undefined,
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
    totalCents: o.totalCents,
    currency: o.currency,
    status: o.status,
    placedAt: o.placedAt,
    createdAt: o.createdAt,
  }));

  const filterLabels: Record<StatusFilter, string> = {
    all: 'All',
    DRAFT: 'Draft',
    AWAITING_REVIEW: 'Review',
    PENDING: 'Pending',
    PAID: 'Paid',
    REFUNDED: 'Refunded',
  };

  return (
    <div className="space-y-3">
      {/* Header with search and new order button */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <input
            type="search"
            placeholder="Search orders..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="input pl-9 h-10 text-sm"
          />
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        </div>
        <Link href="/orders/create" className="btn-primary flex items-center gap-1 h-10 px-3">
          <Plus className="w-4 h-4" />
          <span className="hidden sm:inline">New</span>
        </Link>
      </div>

      {/* Status Filter Pills */}
      <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-4 px-4 scrollbar-hide">
        {(['all', 'DRAFT', 'AWAITING_REVIEW', 'PENDING', 'PAID', 'REFUNDED'] as const).map((status) => (
          <button
            key={status}
            onClick={() => setStatusFilter(status)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
              statusFilter === status
                ? 'bg-primary-600 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {filterLabels[status]}
          </button>
        ))}
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
  );
}
