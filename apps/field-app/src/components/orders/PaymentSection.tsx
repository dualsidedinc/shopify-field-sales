'use client';

import type { PaymentTerms } from '@field-sales/database';
import type { LocationOption } from '../pickers/LocationPicker';
import type { ContactOption } from '../pickers/ContactPicker';

interface PaymentSectionProps {
  shippingLocation: LocationOption | null;
  contact: ContactOption | null;
  paymentTerms: PaymentTerms;
}

// Format payment terms for display
function formatPaymentTerms(terms: PaymentTerms): string {
  switch (terms) {
    case 'DUE_ON_ORDER':
      return 'Due on Order';
    case 'NET_15':
      return 'Net 15';
    case 'NET_30':
      return 'Net 30';
    case 'NET_45':
      return 'Net 45';
    case 'NET_60':
      return 'Net 60';
    default:
      return terms;
  }
}

// Calculate due date based on terms
function calculateDueDate(terms: PaymentTerms): Date | null {
  if (terms === 'DUE_ON_ORDER') {
    return null;
  }

  const days = parseInt(terms.replace('NET_', ''), 10);
  if (isNaN(days)) return null;

  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + days);
  return dueDate;
}

export function PaymentSection({
  shippingLocation,
  contact,
  paymentTerms,
}: PaymentSectionProps) {
  const dueDate = calculateDueDate(paymentTerms);

  return (
    <div className="card">
      <h2 className="font-semibold text-gray-900 mb-2">Payment</h2>

      <div className="divide-y divide-gray-100">
        {/* Payment Terms */}
        <div className="py-3 first:pt-1 space-y-1">
          <div className="flex justify-between items-center">
            <span className="text-sm text-gray-500">Payment Terms</span>
            <span className="font-medium text-gray-900">
              {formatPaymentTerms(paymentTerms)}
            </span>
          </div>
          {dueDate && (
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-500">Due Date</span>
              <span className="text-sm text-gray-600">
                {dueDate.toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                })}
              </span>
            </div>
          )}
        </div>

        {/* Invoice Info — semantic info box, kept subtly tinted */}
        <div className="py-3 last:pb-1">
          {contact ? (
            <div className="flex items-start gap-2 rounded-lg bg-blue-50 p-3">
              <svg
                className="w-5 h-5 text-blue-500 flex-shrink-0 mt-0.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                />
              </svg>
              <div>
                <p className="text-sm font-medium text-blue-800">Invoice will be sent</p>
                <p className="text-sm text-blue-600">
                  {contact.email}
                </p>
              </div>
            </div>
          ) : (
            <p className="text-sm text-gray-500">
              Select a contact to send invoice
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

export default PaymentSection;
