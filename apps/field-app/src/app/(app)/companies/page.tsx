'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Search } from 'lucide-react';
import { api } from '@/lib/api';
import { CompanyList, type CompanyListItemData } from '@/components/lists/CompanyListItem';
import type { CompanyListItem, TerritoryListItem } from '@/types';

export default function CompaniesPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [selectedTerritoryId, setSelectedTerritoryId] = useState<string>('');
  const [companies, setCompanies] = useState<CompanyListItem[]>([]);
  const [territories, setTerritories] = useState<TerritoryListItem[]>([]);
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

  // Fetch territories for filter dropdown
  useEffect(() => {
    async function fetchTerritories() {
      try {
        const { data } = await api.client.territories.list();
        if (data?.items) {
          setTerritories(data.items as TerritoryListItem[]);
        }
      } catch (error) {
        console.error('Error fetching territories:', error);
      }
    }
    fetchTerritories();
  }, []);

  // Reset to page 1 when filters change
  useEffect(() => {
    if (!initialLoad.current) {
      setPage(1);
      setCompanies([]);
    }
    initialLoad.current = false;
  }, [debouncedSearch, selectedTerritoryId]);

  // Fetch companies with filters
  const fetchCompanies = useCallback(async (pageNum: number, append: boolean = false) => {
    if (append) {
      setLoadingMore(true);
    } else {
      setLoading(true);
    }

    try {
      const { data } = await api.client.companies.list({
        page: pageNum,
        pageSize: 30,
        query: debouncedSearch || undefined,
        territoryId: selectedTerritoryId || undefined,
      });

      if (data) {
        if (append) {
          setCompanies(prev => [...prev, ...(data.items as CompanyListItem[])]);
        } else {
          setCompanies(data.items as CompanyListItem[]);
        }
        setHasMore(data.pagination.hasNextPage);
        setTotalCount(data.pagination.totalItems);
      }
    } catch (error) {
      console.error('Error fetching companies:', error);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [debouncedSearch, selectedTerritoryId]);

  useEffect(() => {
    fetchCompanies(page, page > 1);
  }, [page, fetchCompanies]);

  const loadMore = () => {
    if (!loadingMore && hasMore) {
      setPage(prev => prev + 1);
    }
  };

  // Convert to shared component format
  const companyListData: CompanyListItemData[] = companies.map((c) => ({
    id: c.id,
    name: c.name,
    territoryName: c.territoryName,
    accountNumber: c.accountNumber,
  }));

  return (
    <div className="space-y-3">
      {/* Search and Territory Filter */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <input
            type="search"
            placeholder="Search companies..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="input pl-9 h-10 text-sm"
          />
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        </div>
        {territories.length > 0 && (
          <select
            value={selectedTerritoryId}
            onChange={(e) => setSelectedTerritoryId(e.target.value)}
            className="input h-10 text-sm w-auto min-w-[100px]"
          >
            <option value="">All</option>
            {territories.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Results count */}
      {!loading && totalCount > 0 && (
        <p className="text-xs text-gray-500 px-1">
          {totalCount} compan{totalCount !== 1 ? 'ies' : 'y'}
          {debouncedSearch && ` matching "${debouncedSearch}"`}
          {selectedTerritoryId && territories.find(t => t.id === selectedTerritoryId) &&
            ` in ${territories.find(t => t.id === selectedTerritoryId)?.name}`}
        </p>
      )}

      {/* Company List */}
      <CompanyList
        companies={companyListData}
        loading={loading}
        emptyMessage="No companies found"
        emptySubMessage={
          debouncedSearch || selectedTerritoryId
            ? 'Try adjusting your filters'
            : 'Companies will appear here once synced from Shopify'
        }
      />

      {/* Load More */}
      {hasMore && !loading && (
        <button
          onClick={loadMore}
          disabled={loadingMore}
          className="btn-secondary w-full text-sm py-2"
        >
          {loadingMore ? 'Loading...' : `Load more (${companies.length} of ${totalCount})`}
        </button>
      )}
    </div>
  );
}
