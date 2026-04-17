'use client';

import { useState } from 'react';
import type { OrderStatus } from '@field-sales/database';
import { BottomSheet } from '../ui/BottomSheet';

interface StatusActionsProps {
  status: OrderStatus;
  hasLineItems: boolean;
  isSubmitting: boolean;
  shopifyOrderId?: string | null;
  onSubmitForApproval?: (comment?: string) => void;
  onApprove?: (comment?: string) => void;
  onDecline?: (comment?: string) => void;
  onDelete?: () => void;
}

// Status badge helper
function getStatusBadge(status: OrderStatus): { color: string; label: string } {
  switch (status) {
    case 'DRAFT':
      return { color: 'bg-gray-100 text-gray-700', label: 'Draft' };
    case 'AWAITING_REVIEW':
      return { color: 'bg-yellow-100 text-yellow-700', label: 'Awaiting Review' };
    case 'PENDING':
      return { color: 'bg-blue-100 text-blue-700', label: 'Pending Payment' };
    case 'PAID':
      return { color: 'bg-green-100 text-green-700', label: 'Paid' };
    case 'CANCELLED':
      return { color: 'bg-red-100 text-red-700', label: 'Cancelled' };
    case 'REFUNDED':
      return { color: 'bg-red-100 text-red-700', label: 'Refunded' };
    default:
      return { color: 'bg-gray-100 text-gray-700', label: status };
  }
}

export function StatusActions({
  status,
  hasLineItems,
  isSubmitting,
  shopifyOrderId,
  onSubmitForApproval,
  onApprove,
  onDecline,
  onDelete,
}: StatusActionsProps) {
  const [showSubmitModal, setShowSubmitModal] = useState(false);
  const [showApproveModal, setShowApproveModal] = useState(false);
  const [showDeclineModal, setShowDeclineModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [comment, setComment] = useState('');

  // Can delete if DRAFT or AWAITING_REVIEW and not yet in Shopify
  const canDelete = (status === 'DRAFT' || status === 'AWAITING_REVIEW') && !shopifyOrderId;

  const badge = getStatusBadge(status);

  const handleSubmitForApproval = () => {
    if (onSubmitForApproval) {
      onSubmitForApproval(comment || undefined);
      setShowSubmitModal(false);
      setComment('');
    }
  };

  const handleApprove = () => {
    if (onApprove) {
      onApprove(comment || undefined);
      setShowApproveModal(false);
      setComment('');
    }
  };

  const handleDecline = () => {
    if (onDecline) {
      onDecline(comment || undefined);
      setShowDeclineModal(false);
      setComment('');
    }
  };

  const handleDelete = () => {
    if (onDelete) {
      onDelete();
      setShowDeleteModal(false);
    }
  };

  // Check if there are any actions to show
  const hasActions =
    (status === 'DRAFT' && onSubmitForApproval) ||
    (status === 'AWAITING_REVIEW' && (onApprove || onDecline)) ||
    (canDelete && onDelete);

  // Don't render the card if there are no actions
  if (!hasActions && !['PENDING', 'PAID', 'CANCELLED'].includes(status)) {
    return null;
  }

  return (
    <>
        <div className="space-y-3">
          {/* Submit for Approval - DRAFT orders */}
          {status === 'DRAFT' && onSubmitForApproval && (
            <button
              type="button"
              onClick={() => setShowSubmitModal(true)}
              disabled={isSubmitting || !hasLineItems}
              className="w-full btn-primary"
            >
              {isSubmitting ? 'Submitting...' : 'Submit for Approval'}
            </button>
          )}

          {/* Approve/Decline - AWAITING_REVIEW orders */}
          {status === 'AWAITING_REVIEW' && (
            <div className="space-y-2">
              {onApprove && (
                <button
                  type="button"
                  onClick={() => setShowApproveModal(true)}
                  disabled={isSubmitting}
                  className="w-full btn-primary"
                >
                  {isSubmitting ? 'Processing...' : 'Approve Order'}
                </button>
              )}
              {onDecline && (
                <button
                  type="button"
                  onClick={() => setShowDeclineModal(true)}
                  disabled={isSubmitting}
                  className="w-full btn-secondary text-red-600 border-red-300 hover:bg-red-50"
                >
                  Decline Order
                </button>
              )}
            </div>
          )}

          {/* Status info for other states */}
          {status === 'PENDING' && (
            <div className="p-3 bg-blue-50 rounded-lg">
              <p className="text-sm text-blue-700">
                This order is awaiting payment.
              </p>
            </div>
          )}

          {status === 'PAID' && (
            <div className="p-3 bg-green-50 rounded-lg">
              <p className="text-sm text-green-700">
                This order has been paid and is being processed.
              </p>
            </div>
          )}

          {status === 'CANCELLED' && (
            <div className="p-3 bg-red-50 rounded-lg">
              <p className="text-sm text-red-700">
                This order has been cancelled.
              </p>
            </div>
          )}

          {/* Delete Order - DRAFT or AWAITING_REVIEW only, not in Shopify */}
          {canDelete && onDelete && (
            <div className="pt-3">
              <button
                type="button"
                onClick={() => setShowDeleteModal(true)}
                disabled={isSubmitting}
                className="w-full text-red-600 text-sm font-medium hover:text-red-700"
              >

                Delete Order
              </button>
            </div>
          )}
        </div>

      {/* Submit for Approval Modal */}
      <BottomSheet
        isOpen={showSubmitModal}
        onClose={() => {
          setShowSubmitModal(false);
          setComment('');
        }}
        title="Submit for Approval"
        height="auto"
      >
        <div className="p-4">
          <p className="text-gray-600 mb-4">
            This order will be submitted for manager approval.
          </p>
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Comment (optional)
            </label>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Add any notes for the reviewer..."
              rows={3}
              className="input resize-none"
            />
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleSubmitForApproval}
              disabled={isSubmitting}
              className="flex-1 btn-primary"
            >
              {isSubmitting ? 'Submitting...' : 'Submit'}
            </button>
            <button
              type="button"
              onClick={() => {
                setShowSubmitModal(false);
                setComment('');
              }}
              className="flex-1 btn-secondary"
            >
              Cancel
            </button>
          </div>
        </div>
      </BottomSheet>

      {/* Approve Modal */}
      <BottomSheet
        isOpen={showApproveModal}
        onClose={() => {
          setShowApproveModal(false);
          setComment('');
        }}
        title="Approve Order"
        height="auto"
      >
        <div className="p-4">
          <p className="text-gray-600 mb-4">
            This order will be approved and submitted for processing.
          </p>
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Comment (optional)
            </label>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Add any comments..."
              rows={3}
              className="input resize-none"
            />
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleApprove}
              disabled={isSubmitting}
              className="flex-1 btn-primary"
            >
              {isSubmitting ? 'Approving...' : 'Approve'}
            </button>
            <button
              type="button"
              onClick={() => {
                setShowApproveModal(false);
                setComment('');
              }}
              className="flex-1 btn-secondary"
            >
              Cancel
            </button>
          </div>
        </div>
      </BottomSheet>

      {/* Decline Modal */}
      <BottomSheet
        isOpen={showDeclineModal}
        onClose={() => {
          setShowDeclineModal(false);
          setComment('');
        }}
        title="Decline Order"
        height="auto"
      >
        <div className="p-4">
          <p className="text-gray-600 mb-4">
            This order will be declined and returned to draft status.
          </p>
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Reason for declining
            </label>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Please provide a reason..."
              rows={3}
              className="input resize-none"
            />
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleDecline}
              disabled={isSubmitting}
              className="flex-1 bg-red-600 text-white hover:bg-red-700 btn"
            >
              {isSubmitting ? 'Processing...' : 'Decline'}
            </button>
            <button
              type="button"
              onClick={() => {
                setShowDeclineModal(false);
                setComment('');
              }}
              className="flex-1 btn-secondary"
            >
              Cancel
            </button>
          </div>
        </div>
      </BottomSheet>

      {/* Delete Modal */}
      <BottomSheet
        isOpen={showDeleteModal}
        onClose={() => setShowDeleteModal(false)}
        title="Delete Order"
        height="auto"
      >
        <div className="p-4">
          <p className="text-gray-600 mb-4">
            Are you sure you want to delete this order? This action cannot be undone.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleDelete}
              disabled={isSubmitting}
              className="flex-1 bg-red-600 text-white hover:bg-red-700 btn"
            >
              {isSubmitting ? 'Deleting...' : 'Delete Order'}
            </button>
            <button
              type="button"
              onClick={() => setShowDeleteModal(false)}
              className="flex-1 btn-secondary"
            >
              Cancel
            </button>
          </div>
        </div>
      </BottomSheet>
    </>
  );
}

export default StatusActions;
