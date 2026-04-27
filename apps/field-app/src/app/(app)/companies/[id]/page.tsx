'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ChevronLeft, User, MapPin, Phone, Mail, Plus } from 'lucide-react';
import { api } from '@/lib/api';
import { OrderList, type OrderListItemData } from '@/components/lists/OrderListItem';
import {
  ORDER_FILTER_KEYS,
  ORDER_FILTER_LABELS,
  filterToStatusParam,
  type OrderFilterKey,
} from '@/lib/orderStatus';

interface CompanyContact {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  title: string | null;
  isPrimary: boolean;
}

interface CompanyLocation {
  id: string;
  name: string;
  address1: string | null;
  address2: string | null;
  city: string | null;
  province: string | null;
  provinceCode: string | null;
  zipcode: string | null;
  country: string;
  phone: string | null;
  isPrimary: boolean;
  isShippingAddress: boolean;
  isBillingAddress: boolean;
}

interface CompanyWithDetails {
  id: string;
  shopId: string;
  shopifyCompanyId: string | null;
  name: string;
  accountNumber: string | null;
  paymentTerms: string;
  territoryId: string | null;
  assignedRepId: string | null;
  syncStatus: string;
  lastSyncedAt: Date | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  territory?: { name: string } | null;
  assignedRep?: { firstName: string; lastName: string } | null;
  contacts: CompanyContact[];
  locations: CompanyLocation[];
}

export default function CompanyDetailPage() {
  const params = useParams();
  const id = params.id as string;

  const [company, setCompany] = useState<CompanyWithDetails | null>(null);
  const [orders, setOrders] = useState<OrderListItemData[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<OrderFilterKey>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch the company once.
  useEffect(() => {
    async function fetchCompany() {
      try {
        const result = await api.client.companies.get(id);
        if (result.error) {
          setError(result.error.message);
        } else {
          setCompany(result.data as unknown as CompanyWithDetails);
        }
      } catch (err) {
        setError('Failed to load company');
        console.error('Error fetching company:', err);
      } finally {
        setLoading(false);
      }
    }
    fetchCompany();
  }, [id]);

  // Re-fetch orders whenever the status filter changes.
  const fetchOrders = useCallback(async () => {
    setOrdersLoading(true);
    try {
      const { data } = await api.client.orders.list({
        companyId: id,
        pageSize: 30,
        status: filterToStatusParam(statusFilter),
      });
      if (data) {
        setOrders(data.items as unknown as OrderListItemData[]);
      }
    } catch (err) {
      console.error('Error fetching orders:', err);
    } finally {
      setOrdersLoading(false);
    }
  }, [id, statusFilter]);

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  const formatAddress = (location: CompanyLocation) => {
    const parts = [location.address1];
    if (location.address2) parts.push(location.address2);
    const cityState = [location.city, location.provinceCode || location.province, location.zipcode]
      .filter(Boolean)
      .join(', ');
    if (cityState) parts.push(cityState);
    return parts.join('\n');
  };

  // Compact back-arrow header — used in loading / error / loaded states.
  const renderHeader = (title: string, subtitle?: string | null) => (
    <div className="flex items-center gap-1.5 pt-3 pb-3">
      <Link
        href="/companies"
        aria-label="Back to companies"
        className="p-1.5 -ml-1.5 text-gray-500 hover:text-gray-700 flex-shrink-0"
      >
        <ChevronLeft className="w-5 h-5" />
      </Link>
      <div className="min-w-0">
        <h1 className="text-base font-semibold text-gray-900 truncate leading-tight">{title}</h1>
        {subtitle && <p className="text-xs text-gray-500 leading-tight">{subtitle}</p>}
      </div>
    </div>
  );

  if (loading) {
    return <div>{renderHeader('Loading...')}</div>;
  }

  if (error || !company) {
    return (
      <div>
        {renderHeader('Error')}
        <div className="card text-center py-8">
          <p className="text-red-500">{error || 'Company not found'}</p>
          <Link href="/companies" className="btn-secondary mt-4 inline-block">
            Back to Companies
          </Link>
        </div>
      </div>
    );
  }

  const subtitleParts = [
    company.accountNumber && `#${company.accountNumber}`,
    company.territory?.name,
  ].filter(Boolean);
  const subtitle = subtitleParts.length > 0 ? subtitleParts.join(' · ') : null;

  return (
    <div>
      {renderHeader(company.name, subtitle)}

      <div className="space-y-6">
        {/* Orders — table-style list with status filter */}
        <section className="card">
          <div className="flex items-center justify-between gap-2 mb-3">
            <h2 className="font-semibold text-gray-900">Orders</h2>
            <div className="flex items-center gap-2">
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as OrderFilterKey)}
                aria-label="Filter orders by status"
                className="h-8 text-xs bg-white border border-gray-300 rounded-lg pl-2 pr-7 text-gray-900 focus:outline-none focus:ring-2 focus:ring-primary-500 appearance-none cursor-pointer"
                style={{
                  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%236B7280'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M19 9l-7 7-7-7'%3E%3C/path%3E%3C/svg%3E")`,
                  backgroundRepeat: 'no-repeat',
                  backgroundPosition: 'right 6px center',
                  backgroundSize: '12px',
                }}
              >
                {ORDER_FILTER_KEYS.map((key) => (
                  <option key={key} value={key}>
                    {ORDER_FILTER_LABELS[key]}
                  </option>
                ))}
              </select>
              <Link
                href={`/orders/create?companyId=${id}`}
                className="inline-flex items-center gap-1 h-8 px-2.5 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                <Plus className="w-3.5 h-3.5" />
                Create
              </Link>
            </div>
          </div>

          <div className="-mx-4 -mb-4 border-t border-gray-100">
            <OrderList
              orders={orders}
              loading={ordersLoading}
              hideCompany
              bare
              emptyMessage={
                statusFilter === 'all' ? 'No orders yet' : 'No orders match this filter'
              }
              emptySubMessage=""
            />
          </div>
        </section>

        {/* Contacts */}
        <section className="card">
          <h2 className="font-semibold text-gray-900 mb-3">Contacts</h2>
          {company.contacts.length === 0 ? (
            <p className="text-sm text-gray-500">No contacts on file</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {company.contacts.map((contact) => (
                <li
                  key={contact.id}
                  className="flex items-start gap-3 py-3 first:pt-1 last:pb-1"
                >
                  <div className="w-10 h-10 rounded-full bg-primary-100 flex items-center justify-center flex-shrink-0">
                    <User className="w-5 h-5 text-primary-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-gray-900">
                        {contact.firstName} {contact.lastName}
                      </p>
                      {contact.isPrimary && (
                        <span className="badge bg-primary-100 text-primary-700">Primary</span>
                      )}
                    </div>
                    {contact.title && (
                      <p className="text-sm text-gray-500">{contact.title}</p>
                    )}
                    <div className="flex flex-col gap-1 mt-2">
                      <a
                        href={`mailto:${contact.email}`}
                        className="flex items-center gap-2 text-sm text-gray-600 hover:text-primary-600"
                      >
                        <Mail className="w-4 h-4" />
                        <span className="truncate">{contact.email}</span>
                      </a>
                      {contact.phone && (
                        <a
                          href={`tel:${contact.phone}`}
                          className="flex items-center gap-2 text-sm text-gray-600 hover:text-primary-600"
                        >
                          <Phone className="w-4 h-4" />
                          <span>{contact.phone}</span>
                        </a>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Locations */}
        <section className="card">
          <h2 className="font-semibold text-gray-900 mb-3">Locations</h2>
          {company.locations.length === 0 ? (
            <p className="text-sm text-gray-500">No locations on file</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {company.locations.map((location) => (
                <li
                  key={location.id}
                  className="flex items-start gap-3 py-3 first:pt-1 last:pb-1"
                >
                  <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0">
                    <MapPin className="w-5 h-5 text-green-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-medium text-gray-900">{location.name}</p>
                      {location.isPrimary && (
                        <span className="badge bg-primary-100 text-primary-700">Primary</span>
                      )}
                      {location.isShippingAddress && (
                        <span className="badge bg-green-100 text-green-700">Shipping</span>
                      )}
                      {location.isBillingAddress && (
                        <span className="badge bg-blue-100 text-blue-700">Billing</span>
                      )}
                    </div>
                    {location.address1 && (
                      <p className="text-sm text-gray-600 whitespace-pre-line mt-1">
                        {formatAddress(location)}
                      </p>
                    )}
                    {location.phone && (
                      <a
                        href={`tel:${location.phone}`}
                        className="flex items-center gap-2 text-sm text-gray-600 hover:text-primary-600 mt-2"
                      >
                        <Phone className="w-4 h-4" />
                        <span>{location.phone}</span>
                      </a>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
