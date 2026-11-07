'use client';

import {
  canDecide,
  SubmitDecisionRequestSchema,
  type Decision,
  type Review,
  type WorkspaceRole,
} from '@diffcraft/shared';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { FormError, TextAreaField } from '@/components/form-field';
import { dangerButton, primaryButton } from '@/components/styles';
import { submitDecision } from '@/lib/approval-actions';
import { run } from '@/lib/approval-errors';
import { validateForm } from '@/lib/form-errors';

export function DecisionBox({
  workspaceId,
  review,
  viewer,
  isAssigned,
}: {
  workspaceId: string;
  review: Review;
  viewer: { userId: string; role: WorkspaceRole };
  isAssigned: boolean;
}) {
  const router = useRouter();
  const [body, setBody] = useState('');
  const [pending, setPending] = useState<Decision | null>(null);
  const [bodyError, setBodyError] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);

  if (review.author?.id === viewer.userId) {
    return review.status === 'open' ? (
      <p className="text-sm text-slate-500">You can&apos;t review your own change.</p>
    ) : null;
  }
  // The API enforces this; the UI only hides what would be refused.
  if (!canDecide(viewer.role, viewer.userId, review, isAssigned)) return null;

  async function decide(decision: Decision) {
    setError(null);
    const trimmed = body.trim();
    const input = { decision, ...(trimmed && { body: trimmed }) };
    const checked = validateForm(SubmitDecisionRequestSchema, input);
    if (!checked.success) {
      setBodyError(checked.fieldErrors.body);
      return;
    }
    setBodyError(undefined);

    setPending(decision);
    const result = await run(() => submitDecision(workspaceId, String(review.number), input));
    setPending(null);
    if (!result.ok) {
      setBodyError(result.error.fieldErrors?.body);
      setError(result.error.message);
    } else {
      setBody('');
    }
    router.refresh();
  }

  const busy = pending !== null;

  return (
    <section
      aria-labelledby="your-review"
      className="space-y-3 rounded-xl border border-slate-800 bg-slate-950/40 p-4"
    >
      <h2 id="your-review" className="text-sm font-semibold text-slate-200">
        Your review
      </h2>
      {error && <FormError>{error}</FormError>}
      <TextAreaField
        id="decision-body"
        label="Comment (optional)"
        rows={3}
        maxLength={10_000}
        value={body}
        onChange={(event) => setBody(event.target.value)}
        disabled={busy}
        error={bodyError}
      />
      <div className="flex flex-col gap-2 sm:flex-row">
        <button
          type="button"
          onClick={() => decide('approve')}
          disabled={busy}
          className={`${primaryButton} sm:w-auto`}
        >
          {pending === 'approve' ? 'Sending…' : 'Approve'}
        </button>
        <button
          type="button"
          onClick={() => decide('request_changes')}
          disabled={busy}
          className={`${dangerButton} sm:w-auto`}
        >
          {pending === 'request_changes' ? 'Sending…' : 'Request changes'}
        </button>
      </div>
    </section>
  );
}
