'use client';

import { useId, useState, type FormEvent, type KeyboardEvent } from 'react';
import type { CommentActionError } from '@/lib/comment-errors';
import { inputClass, smallSecondaryButton } from './styles';

export const COMMENT_MAX_LENGTH = 10_000;
/** The character counter appears from here on. */
const COUNTER_FROM = 9_000;

const submitButton =
  'inline-flex items-center justify-center rounded-md bg-violet-600 px-3 py-1 text-xs font-semibold text-white transition hover:bg-violet-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 disabled:cursor-not-allowed disabled:opacity-60';

/**
 * A comment textarea with submit and (optionally) cancel. Ctrl/Cmd+Enter submits and Esc cancels.
 * `onSubmit` resolves to the error to show, or null on success (the composer then clears itself).
 */
export function CommentComposer({
  label,
  submitLabel,
  initialValue = '',
  placeholder,
  autoFocus = false,
  onSubmit,
  onCancel,
}: {
  label: string;
  submitLabel: string;
  initialValue?: string;
  placeholder?: string;
  autoFocus?: boolean;
  onSubmit: (body: string) => Promise<CommentActionError | null>;
  onCancel?: () => void;
}) {
  const id = useId();
  const [value, setValue] = useState(initialValue);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const empty = value.trim() === '';

  async function submit() {
    if (sending || empty) return;
    setSending(true);
    setError(null);
    const failure = await onSubmit(value);
    setSending(false);
    if (failure) setError(failure.bodyError ?? failure.message);
    else setValue('');
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    void submit();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      void submit();
    } else if (event.key === 'Escape' && onCancel && !sending) {
      event.preventDefault();
      onCancel();
    }
  }

  const errorId = `${id}-error`;
  return (
    <form onSubmit={handleSubmit} className="space-y-2">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <textarea
        id={id}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={handleKeyDown}
        // Only for composers the user just opened ("+", Reply, Edit), never on page load.
        autoFocus={autoFocus}
        maxLength={COMMENT_MAX_LENGTH}
        rows={3}
        placeholder={placeholder}
        disabled={sending}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className={`${inputClass} min-h-20 resize-y font-sans`}
      />
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" disabled={sending || empty} className={submitButton}>
          {sending ? 'Sending…' : submitLabel}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={sending}
            className={smallSecondaryButton}
          >
            Cancel
          </button>
        )}
        {value.length >= COUNTER_FROM && (
          <span className="text-xs text-slate-500" aria-live="polite">
            {value.length.toLocaleString('en')} / {COMMENT_MAX_LENGTH.toLocaleString('en')}
          </span>
        )}
        <span className="ml-auto hidden text-xs text-slate-600 sm:inline">Ctrl+Enter to send</span>
      </div>
      {error && (
        <p id={errorId} role="alert" className="text-xs text-red-400">
          {error}
        </p>
      )}
    </form>
  );
}
