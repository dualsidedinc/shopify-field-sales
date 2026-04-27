'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Menu } from 'lucide-react';
import { useBranding } from './BrandingProvider';
import { SideMenu } from './SideMenu';

/**
 * Site header — persistent top bar with the slide-out menu trigger on the
 * left and the shop logo on the right. Identity-only: page title and page
 * actions live in `<PageHeader>` below.
 */
export function Header() {
  const { branding, loading } = useBranding();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <>
      <header className="flex items-center justify-between h-12 -mx-4 px-4 bg-white border-b border-gray-200">
        <button
          type="button"
          onClick={() => setMenuOpen(true)}
          className="p-2 -ml-2 text-gray-700 hover:text-gray-900"
          aria-label="Open menu"
        >
          <Menu className="w-5 h-5" />
        </button>

        {loading ? (
          <div className="h-7 w-20 bg-gray-100 rounded animate-pulse" />
        ) : branding?.logoUrl ? (
          <Link href="/dashboard" aria-label="Dashboard">
            <img
              src={branding.logoUrl}
              alt={branding.shopName || 'Logo'}
              className="h-7 max-w-[120px] object-contain"
            />
          </Link>
        ) : (
          <span className="text-sm font-semibold text-gray-900">Field Sales</span>
        )}
      </header>

      <SideMenu isOpen={menuOpen} onClose={() => setMenuOpen(false)} />
    </>
  );
}

export default Header;
