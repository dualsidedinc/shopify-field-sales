'use client';

import Link from 'next/link';
import { ChevronRight, MapPin } from 'lucide-react';

export interface CompanyListItemData {
  id: string;
  name: string;
  territoryName?: string | null;
  accountNumber?: string | null;
}

interface CompanyListItemProps {
  company: CompanyListItemData;
}

function getInitials(name: string): string {
  const words = name.split(' ');
  if (words.length >= 2) {
    return (words[0][0] + words[1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

export function CompanyListItem({ company }: CompanyListItemProps) {
  return (
    <Link
      href={`/companies/${company.id}`}
      className="flex items-center gap-3 px-3 py-2.5 hover:bg-gray-50 active:bg-gray-100 transition-colors"
    >
      {/* Avatar */}
      <div className="w-9 h-9 rounded-full bg-primary-100 flex items-center justify-center flex-shrink-0">
        <span className="text-xs font-semibold text-primary-700">
          {getInitials(company.name)}
        </span>
      </div>

      <div className="flex-1 min-w-0">
        {/* Company Name */}
        <p className="font-medium text-sm text-gray-900 truncate">
          {company.name}
        </p>
        {/* Territory and Account Number */}
        <div className="flex items-center gap-1.5 mt-0.5">
          {company.territoryName && (
            <>
              <MapPin className="w-3 h-3 text-gray-400" />
              <span className="text-xs text-gray-500 truncate max-w-[120px]">
                {company.territoryName}
              </span>
            </>
          )}
          {company.accountNumber && (
            <>
              {company.territoryName && <span className="text-gray-300">·</span>}
              <span className="text-xs text-gray-400">
                #{company.accountNumber}
              </span>
            </>
          )}
          {!company.territoryName && !company.accountNumber && (
            <span className="text-xs text-gray-400">No territory assigned</span>
          )}
        </div>
      </div>

      <ChevronRight className="w-4 h-4 text-gray-300 flex-shrink-0" />
    </Link>
  );
}

interface CompanyListProps {
  companies: CompanyListItemData[];
  loading?: boolean;
  emptyMessage?: string;
  emptySubMessage?: string;
}

export function CompanyList({
  companies,
  loading = false,
  emptyMessage = 'No companies found',
  emptySubMessage = 'Companies will appear here once synced from Shopify',
}: CompanyListProps) {
  return (
    <div className="divide-y divide-gray-100 bg-white rounded-xl shadow-sm border border-gray-100">
      {loading ? (
        <div className="text-center py-8">
          <p className="text-gray-500 text-sm">Loading companies...</p>
        </div>
      ) : companies.length === 0 ? (
        <div className="text-center py-8">
          <p className="text-gray-500 text-sm">{emptyMessage}</p>
          <p className="text-xs text-gray-400 mt-1">{emptySubMessage}</p>
        </div>
      ) : (
        companies.map((company) => (
          <CompanyListItem key={company.id} company={company} />
        ))
      )}
    </div>
  );
}
