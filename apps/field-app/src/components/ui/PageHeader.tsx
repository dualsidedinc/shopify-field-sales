'use client';

import type { ReactNode } from 'react';

interface PageHeaderProps {
  title: string;
  /** Optional right-aligned action(s): a button, link, or group of buttons. */
  action?: ReactNode;
}

/**
 * Page-level header that sits beneath the site `<Header>`. Renders the page
 * title on the left and optional action(s) on the right.
 */
export function PageHeader({ title, action }: PageHeaderProps) {
  return (
    <div className="flex items-center justify-between gap-3 pt-4 pb-3">
      <h1 className="text-2xl font-bold text-gray-900 truncate">{title}</h1>
      {action && <div className="flex items-center gap-2 flex-shrink-0">{action}</div>}
    </div>
  );
}

export default PageHeader;
