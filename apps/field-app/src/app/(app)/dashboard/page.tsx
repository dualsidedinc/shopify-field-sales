'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ClipboardList, Building2, Clock, ChevronRight } from 'lucide-react';
import { api } from '@/lib/api';
import { CompanyList, type CompanyListItemData } from '@/components/lists/CompanyListItem';
import { OrderList, type OrderListItemData } from '@/components/lists/OrderListItem';

interface DashboardMetrics {
  ordersThisMonth: number;
  orderChange: number;
  accountCount: number;
  pendingOrders: number;
}

interface DashboardData {
  metrics: DashboardMetrics;
  orders: {
    draft: OrderListItemData[];
  };
  latestCompanies: CompanyListItemData[];
}

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchDashboard() {
      try {
        const { data: result } = await api.client.dashboard.stats();

        if (result) {
          setData(result as unknown as DashboardData);
        }
      } catch (error) {
        console.error('Error fetching dashboard:', error);
      } finally {
        setLoading(false);
      }
    }

    fetchDashboard();
  }, []);

  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      <div className="grid grid-cols-3 gap-3">
        <div className="card">
          <div className="flex items-center gap-2 mb-1">
            <ClipboardList className="w-4 h-4 text-primary-500" />
            <p className="text-sm text-gray-500">Orders</p>
          </div>
          <p className="text-2xl font-bold text-primary-600">
            {loading ? '--' : data?.metrics.ordersThisMonth || 0}
          </p>
        </div>
        <div className="card">
          <div className="flex items-center gap-2 mb-1">
            <Building2 className="w-4 h-4 text-primary-500" />
            <p className="text-sm text-gray-500">Companies</p>
          </div>
          <p className="text-2xl font-bold text-primary-600">
            {loading ? '--' : data?.metrics.accountCount || 0}
          </p>
        </div>
        <div className="card">
          <div className="flex items-center gap-2 mb-1">
            <Clock className="w-4 h-4 text-amber-500" />
            <p className="text-sm text-gray-500">Pending</p>
          </div>
          <p className="text-2xl font-bold text-amber-600">
            {loading ? '--' : data?.metrics.pendingOrders || 0}
          </p>
        </div>
      </div>

      {/* Draft Orders - Orders needing action */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-gray-900">Draft Orders</h2>
          <Link href="/orders" className="text-sm link flex items-center gap-1">
            View All
            <ChevronRight className="w-4 h-4" />
          </Link>
        </div>
        <OrderList
          orders={data?.orders.draft || []}
          loading={loading}
          emptyMessage="No draft orders"
          emptySubMessage="Start a new order from an account"
          showDate="updated"
        />
      </section>

      {/* Latest Companies */}
      {!loading && data?.latestCompanies && data.latestCompanies.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold text-gray-900">Latest Companies</h2>
            <Link href="/companies" className="text-sm link flex items-center gap-1">
              View All
              <ChevronRight className="w-4 h-4" />
            </Link>
          </div>
          <CompanyList companies={data.latestCompanies} />
        </section>
      )}
    </div>
  );
}
