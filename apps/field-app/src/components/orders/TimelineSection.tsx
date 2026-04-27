'use client';

import { useState, useCallback, useMemo } from 'react';
import type { TimelineEvent } from '@/hooks/useOrderForm';

interface TimelineSectionProps {
  events: TimelineEvent[];
  onAddComment?: (comment: string) => void;
  /** Initials shown in the comment composer avatar (e.g. "JR"). Optional. */
  currentUserInitials?: string;
}

// Format event message based on type
function formatEventMessage(event: TimelineEvent): string {
  const metadata = event.metadata || {};

  switch (event.eventType) {
    case 'draft_created':
      return 'Order created as draft';
    case 'submitted':
      return 'Order submitted for approval';
    case 'approved':
      return 'Order approved';
    case 'declined':
      return 'Order declined';
    case 'cancelled':
      return 'Order cancelled';
    case 'paid':
      return 'Order marked as paid';
    case 'refunded':
      return 'Order refunded';
    case 'comment':
      return '';
    case 'deleted':
      return 'Order deleted';
    case 'company_changed':
      return `Changed company from "${metadata.oldValue || 'none'}" to "${metadata.newValue}"`;
    case 'contact_changed':
      return `Changed contact from "${metadata.oldValue || 'none'}" to "${metadata.newValue}"`;
    case 'shipping_location_changed':
      return `Changed shipping location from "${metadata.oldValue || 'none'}" to "${metadata.newValue}"`;
    case 'line_item_added':
      return `Added ${metadata.quantity || 1}x ${metadata.productTitle}${
        metadata.variantTitle ? ` (${metadata.variantTitle})` : ''
      }`;
    case 'line_item_removed':
      return `Removed ${metadata.quantity || 1}x ${metadata.productTitle}${
        metadata.variantTitle ? ` (${metadata.variantTitle})` : ''
      }`;
    case 'line_item_quantity_changed':
      return `Changed quantity of ${metadata.productTitle}${
        metadata.variantTitle ? ` (${metadata.variantTitle})` : ''
      } from ${metadata.oldValue} to ${metadata.newValue}`;
    case 'promotion_applied':
      return `Applied promotion: ${metadata.promotionName}`;
    case 'promotion_removed':
      return `Removed promotion: ${metadata.promotionName}`;
    default:
      return event.eventType.replace(/_/g, ' ');
  }
}

function formatTime(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

function formatDateGroup(dateStr: string): string {
  const date = new Date(dateStr);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);

  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();

  if (sameDay(date, today)) return 'Today';
  if (sameDay(date, yesterday)) return 'Yesterday';

  // Same year → "April 22"; different year → "April 22, 2024"
  const isSameYear = date.getFullYear() === today.getFullYear();
  return date.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    ...(isSameYear ? {} : { year: 'numeric' }),
  });
}

interface DateGroup {
  label: string;
  events: TimelineEvent[];
}

function groupByDate(events: TimelineEvent[]): DateGroup[] {
  const groups: DateGroup[] = [];
  let currentLabel: string | null = null;
  for (const event of events) {
    const label = formatDateGroup(event.createdAt);
    if (label !== currentLabel) {
      groups.push({ label, events: [] });
      currentLabel = label;
    }
    groups[groups.length - 1].events.push(event);
  }
  return groups;
}

export function TimelineSection({
  events,
  onAddComment,
  currentUserInitials,
}: TimelineSectionProps) {
  const [newComment, setNewComment] = useState('');

  const handleAddComment = useCallback(() => {
    if (newComment.trim() && onAddComment) {
      onAddComment(newComment.trim());
      setNewComment('');
    }
  }, [newComment, onAddComment]);

  const groups = useMemo(() => groupByDate(events), [events]);
  const initials = (currentUserInitials || 'U').slice(0, 2).toUpperCase();

  return (
    <section>
      <h2 className="text-xs font-medium uppercase tracking-wide text-gray-500 mb-3">
        Timeline
      </h2>

      {/* Comment composer */}
      {onAddComment && (
        <>
          <div className="bg-white rounded-xl ring-1 ring-gray-200 overflow-hidden mb-1">
            <div className="flex items-start gap-3 p-3">
              <div className="w-8 h-8 rounded bg-blue-400 text-white text-xs font-medium flex items-center justify-center flex-shrink-0">
                {initials}
              </div>
              <textarea
                value={newComment}
                onChange={(e) => setNewComment(e.target.value)}
                placeholder="Leave a comment..."
                rows={1}
                className="flex-1 text-sm placeholder:text-gray-400 resize-none focus:outline-none min-h-[32px] py-1"
                onInput={(e) => {
                  const el = e.currentTarget;
                  el.style.height = 'auto';
                  el.style.height = `${el.scrollHeight}px`;
                }}
              />
            </div>
            <div className="flex items-center justify-end px-3 py-2 bg-gray-50 border-t border-gray-100">
              <button
                type="button"
                onClick={handleAddComment}
                disabled={!newComment.trim()}
                className="btn-primary text-xs px-3 py-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Post
              </button>
            </div>
          </div>
          <p className="text-xs text-gray-400 text-right mb-4">
            Only you and other staff can see comments
          </p>
        </>
      )}

      {/* Timeline events */}
      {events.length === 0 ? (
        <p className="text-sm text-gray-500 py-4 text-center">No timeline events yet</p>
      ) : (
        <div className="relative pl-5 border-l border-gray-200 space-y-5">
          {groups.map((group) => (
            <div key={group.label}>
              <p className="text-xs font-medium text-gray-500 mb-3">{group.label}</p>
              <ul className="space-y-3">
                {group.events.map((event) => {
                  const message = formatEventMessage(event);
                  return (
                    <li key={event.id} className="relative">
                      <span
                        className="absolute -left-[24px] top-1.5 w-2 h-2 rounded-full bg-white ring-2 ring-gray-300"
                        aria-hidden
                      />
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0 text-sm">
                          {message && <p className="text-gray-700">{message}</p>}
                          {event.comment && (
                            <div className={message ? 'mt-1.5' : ''}>
                              <p className="font-medium text-gray-900">{event.authorName}</p>
                              <p className="text-gray-600 mt-0.5 whitespace-pre-wrap">
                                {event.comment}
                              </p>
                            </div>
                          )}
                          {!message && !event.comment && (
                            <p className="text-gray-700">
                              {event.eventType.replace(/_/g, ' ')}
                            </p>
                          )}
                        </div>
                        <span className="text-xs text-gray-400 whitespace-nowrap pt-0.5">
                          {formatTime(event.createdAt)}
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export default TimelineSection;
