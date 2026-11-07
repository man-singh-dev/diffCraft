'use client';

import {
  canAssignReviewers,
  hasAtLeastRole,
  type Review,
  type Reviewer,
  type WorkspaceMember,
  type WorkspaceRole,
} from '@diffcraft/shared';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { DateTime, DecisionMark } from '@/components/approval-ui';
import { FormError } from '@/components/form-field';
import { smallDangerButton, smallSecondaryButton } from '@/components/styles';
import { assignReviewers, removeReviewer } from '@/lib/approval-actions';
import { run, type ApprovalActionError } from '@/lib/approval-errors';

export function ReviewersPanel({
  workspaceId,
  review,
  viewer,
  reviewers,
  eligible,
}: {
  workspaceId: string;
  review: Review;
  viewer: { userId: string; role: WorkspaceRole };
  reviewers: Reviewer[];
  eligible: WorkspaceMember[];
}) {
  const router = useRouter();
  const [picking, setPicking] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ApprovalActionError | null>(null);
  const [pickedNames, setPickedNames] = useState<ReadonlyMap<string, string>>(new Map());

  const reviewNumber = String(review.number);
  const changeable = review.status !== 'merged';
  // The API enforces this; the UI only hides what would be refused.
  const canAssign =
    changeable && canAssignReviewers(viewer.role, viewer.userId, review.author?.id ?? null);
  const canLeave = changeable && hasAtLeastRole(viewer.role, 'member');

  async function handleAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (selected.length === 0) return;
    setPending(true);
    setError(null);
    // The refresh after a failure can drop these people from the picker, so keep their names.
    setPickedNames(new Map(eligible.map((m) => [m.userId, m.displayName])));
    const result = await run(() =>
      assignReviewers(workspaceId, reviewNumber, { userIds: selected }),
    );
    setPending(false);
    if (!result.ok) {
      setError(result.error);
    } else {
      setSelected([]);
      setPicking(false);
    }
    router.refresh();
  }

  async function handleRemove(userId: string) {
    setPending(true);
    setError(null);
    const result = await run(() => removeReviewer(workspaceId, reviewNumber, userId));
    setPending(false);
    if (!result.ok) setError(result.error);
    router.refresh();
  }

  const toggle = (userId: string) =>
    setSelected((list) =>
      list.includes(userId) ? list.filter((id) => id !== userId) : [...list, userId],
    );

  return (
    <section aria-labelledby="reviewers" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="reviewers" className="text-sm font-semibold text-slate-200">
          Reviewers ({reviewers.length})
        </h2>
        {canAssign && !picking && (
          <button
            type="button"
            onClick={() => setPicking(true)}
            disabled={pending}
            className={smallSecondaryButton}
          >
            Add reviewers
          </button>
        )}
      </div>

      {error && (
        <FormError>
          {error.message}
          {error.reviewerErrors && error.reviewerErrors.length > 0 && (
            <ul className="mt-1 list-disc pl-5">
              {error.reviewerErrors.map(({ userId, message }) => (
                <li key={userId}>
                  {pickedNames.get(userId) ?? 'Someone'} {message}.
                </li>
              ))}
            </ul>
          )}
        </FormError>
      )}

      {reviewers.length === 0 ? (
        <p className="text-sm text-slate-500">No reviewers yet.</p>
      ) : (
        <ul className="divide-y divide-slate-800 rounded-xl border border-slate-800">
          {reviewers.map(({ user, latestDecision, decidedAt }) => {
            const isMe = user.id === viewer.userId;
            return (
              <li key={user.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                <span className="min-w-0 flex-1 truncate text-sm text-slate-100">
                  {user.displayName}
                  {isMe && <span className="ml-2 text-xs text-slate-500">(you)</span>}
                </span>
                <DecisionMark decision={latestDecision} />
                {decidedAt && (
                  <span className="text-xs text-slate-500">
                    <DateTime value={decidedAt} />
                  </span>
                )}
                {isMe && canLeave ? (
                  <button
                    type="button"
                    onClick={() => handleRemove(user.id)}
                    disabled={pending}
                    className={smallSecondaryButton}
                  >
                    Remove me
                  </button>
                ) : (
                  canAssign && (
                    <button
                      type="button"
                      onClick={() => handleRemove(user.id)}
                      disabled={pending}
                      aria-label={`Remove ${user.displayName}`}
                      className={smallDangerButton}
                    >
                      ×
                    </button>
                  )
                )}
              </li>
            );
          })}
        </ul>
      )}

      {canAssign && picking && (
        <form
          onSubmit={handleAdd}
          className="space-y-3 rounded-xl border border-slate-800 bg-slate-950/40 p-4"
        >
          {eligible.length === 0 ? (
            <p className="text-sm text-slate-500">Everyone who can review is already assigned.</p>
          ) : (
            <fieldset className="space-y-2">
              <legend className="mb-2 text-sm font-medium text-slate-300">
                Choose up to 10 reviewers
              </legend>
              {eligible.map((member) => (
                <label
                  key={member.userId}
                  className="flex items-center gap-2 text-sm text-slate-200"
                >
                  <input
                    type="checkbox"
                    checked={selected.includes(member.userId)}
                    onChange={() => toggle(member.userId)}
                    disabled={
                      pending || (!selected.includes(member.userId) && selected.length >= 10)
                    }
                    className="accent-violet-500"
                  />
                  {member.displayName}
                </label>
              ))}
            </fieldset>
          )}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={pending || selected.length === 0}
              className={smallSecondaryButton}
            >
              {pending ? 'Adding…' : `Add${selected.length > 0 ? ` ${selected.length}` : ''}`}
            </button>
            <button
              type="button"
              onClick={() => {
                setPicking(false);
                setSelected([]);
              }}
              disabled={pending}
              className={smallSecondaryButton}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
