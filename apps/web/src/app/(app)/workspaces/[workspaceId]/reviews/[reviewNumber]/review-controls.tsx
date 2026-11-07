'use client';

import { canTransition, UpdateReviewRequestSchema, type Review } from '@diffcraft/shared';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { FormError, FormField, TextAreaField } from '@/components/form-field';
import {
  primaryButton,
  secondaryButton,
  smallDangerButton,
  smallSecondaryButton,
} from '@/components/styles';
import { deleteReview, updateReview } from '@/lib/api-client';
import { validateForm, type FieldErrors } from '@/lib/form-errors';
import { describeReviewError } from '@/lib/review-errors';

type Pending = 'save' | 'status' | 'delete' | null;

export function ReviewControls({ workspaceId, review }: { workspaceId: string; review: Review }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [pending, setPending] = useState<Pending>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setError(null);

    const input = validateForm(UpdateReviewRequestSchema, {
      title: form.get('edit-title'),
      description: form.get('edit-description'),
    });
    if (!input.success) {
      setFieldErrors(input.fieldErrors);
      return;
    }
    setFieldErrors({});

    setPending('save');
    const result = await updateReview(workspaceId, review.number, input.data);
    setPending(null);
    if (!result.ok) {
      setFieldErrors(result.fieldErrors);
      setError(describeReviewError(result));
      return;
    }
    setEditing(false);
    router.refresh();
  }

  const nextStatus = review.status === 'open' ? 'closed' : 'open';
  const canToggle = canTransition(review.status, nextStatus);

  async function handleStatus() {
    setError(null);
    setPending('status');
    const result = await updateReview(workspaceId, review.number, { status: nextStatus });
    setPending(null);
    if (!result.ok) setError(describeReviewError(result));
    // Also after a failure: a 403 or 404 means this page is out of date.
    router.refresh();
  }

  async function handleDelete() {
    setError(null);
    setPending('delete');
    const result = await deleteReview(workspaceId, review.number);
    if (!result.ok) {
      setPending(null);
      setConfirmingDelete(false);
      setError(describeReviewError(result));
      return;
    }
    // Stays pending while navigating away from the deleted review.
    router.push(`/workspaces/${workspaceId}/reviews`);
    router.refresh();
  }

  const busy = pending !== null;

  return (
    <section aria-label="Review actions" className="space-y-3">
      {error && <FormError>{error}</FormError>}

      {editing ? (
        <form onSubmit={handleSave} noValidate className="space-y-4">
          <FormField
            id="edit-title"
            label="Title"
            type="text"
            required
            maxLength={200}
            defaultValue={review.title}
            error={fieldErrors.title}
          />
          <TextAreaField
            id="edit-description"
            label="Description"
            rows={5}
            maxLength={10_000}
            defaultValue={review.description ?? ''}
            hint="Leave empty to remove the description."
            error={fieldErrors.description}
          />
          <div className="flex flex-col gap-3 sm:flex-row">
            <button type="submit" disabled={busy} className={primaryButton}>
              {pending === 'save' ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setEditing(false);
                setFieldErrors({});
                setError(null);
              }}
              className={secondaryButton}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => setEditing(true)}
            className={smallSecondaryButton}
          >
            Edit
          </button>
          {canToggle && (
            <button
              type="button"
              disabled={busy}
              onClick={handleStatus}
              className={smallSecondaryButton}
            >
              {pending === 'status'
                ? 'Saving…'
                : nextStatus === 'closed'
                  ? 'Close review'
                  : 'Reopen review'}
            </button>
          )}

          {confirmingDelete ? (
            <>
              <span className="text-xs text-red-300">
                Really delete? This can&apos;t be undone.
              </span>
              <button
                type="button"
                disabled={busy}
                onClick={handleDelete}
                autoFocus
                className={smallDangerButton}
              >
                {pending === 'delete' ? 'Deleting…' : 'Yes, delete'}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => setConfirmingDelete(false)}
                className={smallSecondaryButton}
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={() => setConfirmingDelete(true)}
              className={smallDangerButton}
            >
              Delete
            </button>
          )}
        </div>
      )}
    </section>
  );
}
