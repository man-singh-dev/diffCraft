'use client';

import type { Review } from '@diffcraft/shared';
import { useState } from 'react';
import { ReviewRow } from '@/components/review-ui';
import { secondaryButton } from '@/components/styles';
import { listReviews } from '@/lib/api-client';
import { describeReviewError } from '@/lib/review-errors';
import type { ReviewFilters } from '@/lib/review-params';

/** The server-rendered first page (`children`), followed by any pages loaded here. */
export function LoadMoreReviews({
  workspaceId,
  filters,
  nextCursor: firstCursor,
  children,
}: {
  workspaceId: string;
  filters: ReviewFilters;
  nextCursor: string | null;
  children: React.ReactNode;
}) {
  const [items, setItems] = useState<Review[]>([]);
  const [cursor, setCursor] = useState(firstCursor);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    if (!cursor) return;
    setPending(true);
    setError(null);
    const result = await listReviews(workspaceId, filters, cursor);
    setPending(false);
    if (!result.ok) {
      setError(describeReviewError(result));
      return;
    }
    // The keyset cursor never repeats rows; this only guards React keys if that ever changes.
    setItems((previous) => {
      const seen = new Set(previous.map((r) => r.id));
      return [...previous, ...result.data.items.filter((r) => !seen.has(r.id))];
    });
    setCursor(result.data.nextCursor);
  }

  return (
    <div className="space-y-3">
      <ul className="divide-y divide-slate-800 rounded-xl border border-slate-800">
        {children}
        {items.map((review) => (
          <ReviewRow key={review.id} review={review} />
        ))}
      </ul>
      {error && (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      )}
      {cursor && (
        <button type="button" onClick={handleClick} disabled={pending} className={secondaryButton}>
          {pending ? 'Loading…' : 'Load more'}
        </button>
      )}
    </div>
  );
}
