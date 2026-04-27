'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/ui';
import type { QuotaPaceIndicator } from '@field-sales/shared';

interface Profile {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  role: string;
  isActive: boolean;
  createdAt: string;
  tenant: {
    name: string;
    domain: string;
  };
  territories: string[];
  stats: {
    assignedCompanies: number;
    totalOrders: number;
  };
}

interface QuotaProgress {
  hasQuota: boolean;
  targetCents: number | null;
  achievedCents: number;
  projectedCents: number;
  progressPercent: number;
  projectedPercent: number;
  remainingCents: number;
  daysRemaining: number;
  onPaceIndicator: QuotaPaceIndicator;
}

interface CompanyRevenue {
  id: string;
  name: string;
  accountNumber: string | null;
  revenueCents: number;
}

interface RepMetrics {
  revenue: number;
  revenueChange: number;
  quota: QuotaProgress | null;
  companiesByRevenue: CompanyRevenue[];
}

export default function AccountPage() {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [metrics, setMetrics] = useState<RepMetrics | null>(null);
  const [loading, setLoading] = useState(true);

  // Top companies are returned as part of metrics now — derived state, no
  // separate fetch.
  const companiesByRevenue: CompanyRevenue[] = metrics?.companiesByRevenue ?? [];

  useEffect(() => {
    async function fetchData() {
      try {
        const [profileRes, metricsRes] = await Promise.all([
          api.client.profile.get(),
          fetch('/api/profile/metrics').then((r) => r.json()),
        ]);

        if (profileRes.data) {
          setProfile(profileRes.data as Profile);
        }
        if (metricsRes.data) {
          setMetrics(metricsRes.data);
        }
      } catch (error) {
        console.error('Error fetching data:', error);
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, []);

  async function handleLogout() {
    try {
      await api.client.auth.logout();
      router.push('/login');
      router.refresh();
    } catch {
      // Handle error
    }
  }

  const formatPrice = (amount: number, currency: string = 'USD') => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  const getQuotaStatusColor = (indicator: QuotaPaceIndicator) => {
    switch (indicator) {
      case 'ahead': return 'text-green-600';
      case 'on_pace': return 'text-blue-600';
      case 'behind': return 'text-yellow-600';
      case 'at_risk': return 'text-red-600';
      default: return 'text-gray-500';
    }
  };

  const getQuotaStatusLabel = (indicator: QuotaPaceIndicator) => {
    switch (indicator) {
      case 'ahead': return 'Ahead';
      case 'on_pace': return 'On Pace';
      case 'behind': return 'Behind';
      case 'at_risk': return 'At Risk';
      default: return 'No Quota';
    }
  };

  return (
    <div>
      <PageHeader title="My Account" />

      <div className="space-y-6">
      {/* Revenue & Quota Cards */}
      {!loading && metrics && (
        <div className="grid grid-cols-2 gap-4">
          {/* Revenue Card */}
          <div className="card">
            <p className="text-sm text-gray-500">Revenue</p>
            <p className="text-2xl font-bold text-gray-900">
              {formatPrice(metrics.revenue)}
            </p>
            {metrics.revenueChange !== 0 && (
              <p className={`text-xs ${metrics.revenueChange > 0 ? 'text-green-600' : 'text-red-600'}`}>
                {metrics.revenueChange > 0 ? '+' : ''}{metrics.revenueChange}% vs last month
              </p>
            )}
          </div>

          {/* Quota Card */}
          {metrics.quota && (
            <div className="card">
              <p className="text-sm text-gray-500">Quota</p>
              {metrics.quota.hasQuota ? (
                <>
                  <p className="text-2xl font-bold text-gray-900">
                    {metrics.quota.progressPercent}%
                  </p>
                  <p className={`text-xs ${getQuotaStatusColor(metrics.quota.onPaceIndicator)}`}>
                    {getQuotaStatusLabel(metrics.quota.onPaceIndicator)}
                    {metrics.quota.daysRemaining > 0 && ` • ${metrics.quota.daysRemaining}d left`}
                  </p>
                </>
              ) : (
                <p className="text-lg text-gray-400">No quota set</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Companies by Revenue */}
      <section className="card">
        <h2 className="font-semibold text-gray-900 mb-3">Companies by Revenue</h2>
        {loading ? (
          <p className="text-gray-500 text-sm">Loading...</p>
        ) : companiesByRevenue.length === 0 ? (
          <p className="text-gray-500 text-sm">No revenue this month</p>
        ) : (
          <div className="space-y-3">
            {companiesByRevenue.map((company, index) => (
              <Link
                key={company.id}
                href={`/companies/${company.id}`}
                className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0"
              >
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium text-gray-400 w-5">{index + 1}</span>
                  <div>
                    <p className="font-medium text-gray-900">{company.name}</p>
                    {company.accountNumber && (
                      <p className="text-xs text-gray-500">#{company.accountNumber}</p>
                    )}
                  </div>
                </div>
                <span className="font-semibold text-gray-900">
                  {formatPrice(company.revenueCents / 100)}
                </span>
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* Sales Rep Card */}
      <section className="card">
        <h2 className="font-semibold text-gray-900 mb-3">Sales Rep</h2>
        {loading ? (
          <p className="text-gray-500 text-sm">Loading...</p>
        ) : profile ? (
          <div className="space-y-4">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 bg-primary-100 rounded-full flex items-center justify-center">
                <span className="text-xl font-semibold text-primary-600">
                  {profile.firstName[0]}{profile.lastName[0]}
                </span>
              </div>
              <div>
                <p className="font-semibold text-lg text-gray-900">
                  {profile.firstName} {profile.lastName}
                </p>
                <p className="text-sm text-gray-500">{profile.email}</p>
              </div>
            </div>

            {profile.territories.length > 0 && (
              <div className="pt-3 border-t border-gray-100">
                <p className="text-sm text-gray-500 mb-2">Territories</p>
                <div className="flex flex-wrap gap-2">
                  {profile.territories.map((territory) => (
                    <span
                      key={territory}
                      className="px-3 py-1 bg-gray-100 text-gray-700 text-sm rounded-full"
                    >
                      {territory}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div className="pt-3 border-t border-gray-100 grid grid-cols-2 gap-4">
              <div className="text-center">
                <p className="text-2xl font-bold text-gray-900">{profile.stats.assignedCompanies}</p>
                <p className="text-xs text-gray-500">Companies</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-bold text-gray-900">{profile.stats.totalOrders}</p>
                <p className="text-xs text-gray-500">Orders</p>
              </div>
            </div>
          </div>
        ) : (
          <p className="text-gray-500 text-sm">Could not load profile</p>
        )}
      </section>

      {/* Logout */}
      <button
        onClick={handleLogout}
        className="w-full py-3 text-red-600 font-medium rounded-lg border border-red-200 hover:bg-red-50 transition-colors"
      >
        Sign Out
      </button>
      </div>
    </div>
  );
}
