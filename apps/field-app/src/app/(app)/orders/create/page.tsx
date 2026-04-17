'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { OrderForm } from '@/components/orders/OrderForm';

function OrderCreateContent() {
  const searchParams = useSearchParams();
  const companyId = searchParams.get('companyId') || undefined;

  return (
    <OrderForm
      mode="create"
      companyId={companyId}
      onSuccess={(orderId) => {
        console.log('Order created:', orderId);
      }}
    />
  );
}

export default function OrderCreatePage() {
  return (
    <Suspense fallback={<div className="p-4 text-center text-gray-500">Loading...</div>}>
      <OrderCreateContent />
    </Suspense>
  )
}
