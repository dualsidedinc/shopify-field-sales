'use client';

import Link from 'next/link';

export interface CompanyListItemData {
  id: string;
  name: string;
  territoryName?: string | null;
  accountNumber?: string | null;
}

interface CompanyListItemProps {
  company: CompanyListItemData;
}

/**
 * Three-tier hierarchy:
 *   1. Company name — primary, semibold base.
 *   2. Account number — secondary, gray.
 *   3. Territory — subdued reference footer.
 *
 * Lines collapse when their data is missing — no reserved blank rows.
 */
export function CompanyListItem({ company }: CompanyListItemProps) {
  return (
    <Link
      href={`/companies/${company.id}`}
      className="block px-4 py-4 hover:bg-gray-50 active:bg-gray-100 transition-colors"
    >
      <h3 className="text-base font-semibold text-gray-900 truncate">{company.name}</h3>
      {company.accountNumber && (
        <p className="text-sm text-gray-500 truncate mt-0.5">#{company.accountNumber}</p>
      )}
      {company.territoryName && (
        <p className="text-xs text-gray-400 truncate mt-1">{company.territoryName}</p>
      )}
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
    <div className="bg-white rounded-xl ring-1 ring-gray-200 overflow-hidden divide-y divide-gray-100">
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
        companies.map((company) => <CompanyListItem key={company.id} company={company} />)
      )}
    </div>
  );
}
