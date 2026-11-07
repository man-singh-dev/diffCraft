'use client';

import { canMerge, type Review, type ReviewState, type WorkspaceRole } from '@diffcraft/shared';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { FormError } from '@/components/form-field';
import { primaryButton, smallSecondaryButton } from '@/components/styles';
import { mergeReview } from '@/lib/approval-actions';
import { run, type ApprovalActionError } from '@/lib/approval-errors';

export function MergeBox({
  workspaceId,
  review,
  state,
  viewer,
}: {
  workspaceId: string;
  review: Review;
  state: ReviewState;
  viewer: { userId: string; role: WorkspaceRole };
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ApprovalActionError | null>(null);

  // The API enforces this; the UI only hides what would be refused.
  const mayMerge = canMerge(viewer.role, viewer.userId, review.author?.id ?? null);

  async function handleMerge() {
    setPending(true);
    setError(null);
    const result = await run(() => mergeReview(workspaceId, String(review.number)));
    setPending(false);
    setConfirming(false);
    if (!result.ok) setError(result.error);
    // Also after a failure: a 409 means the page is out of date.
    router.refresh();
  }

  return (
    <section
      aria-labelledby="merge-status"
      className="space-y-3 rounded-xl border border-slate-800 bg-slate-950/40 p-4"
    >
      <h2 id="merge-status" className="text-sm font-semibold text-slate-200">
        {state.canMerge ? 'Ready to merge' : "Can't merge yet"}
      </h2>
      {!state.canMerge && (
        <ul id="merge-reasons" className="list-disc space-y-1 pl-5 text-sm text-slate-400">
          {state.reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      )}

      {error && (
        <FormError>
          {error.message}
          {error.reasons && error.reasons.length > 0 && (
            <ul className="mt-1 list-disc pl-5">
              {error.reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          )}
        </FormError>
      )}

      {mayMerge &&
        (confirming ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-slate-200">Merge #{review.number}?</span>
            <button
              type="button"
              onClick={handleMerge}
              disabled={pending}
              autoFocus
              className={`${primaryButton} w-auto px-3 py-1 text-xs`}
            >
              {pending ? 'Merging…' : 'Confirm'}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={pending}
              className={smallSecondaryButton}
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            disabled={!state.canMerge || pending}
            aria-describedby={state.canMerge ? undefined : 'merge-reasons'}
            className={`${primaryButton} w-auto`}
          >
            Merge
          </button>
        ))}
    </section>
  );
}
