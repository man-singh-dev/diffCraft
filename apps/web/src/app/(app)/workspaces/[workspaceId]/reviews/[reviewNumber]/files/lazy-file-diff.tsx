'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState, useTransition } from 'react';
import { DiffTable } from '@/components/diff-table';
import { smallSecondaryButton } from '@/components/styles';
import { loadFileDiff, type LoadFileDiffError } from '@/lib/diff-actions';
import type { DiffView } from '@/lib/diff-params';
import type { DiffRows } from '@/lib/diff-view.server';
import { onRevealFile } from '@/lib/reveal-file';

const ERROR_TEXT: Record<LoadFileDiffError, string> = {
  unauthorized: 'Your session has ended.',
  not_found: 'This file no longer exists.',
  failed: "Couldn't load this diff.",
};

export function LazyFileDiff({
  workspaceId,
  reviewNumber,
  fileId,
  view,
  changedLines,
  initialError,
}: {
  workspaceId: string;
  reviewNumber: string;
  fileId: string;
  view: DiffView;
  changedLines: number;
  initialError?: LoadFileDiffError;
}) {
  const [diff, setDiff] = useState<DiffRows | null>(null);
  const [error, setError] = useState<LoadFileDiffError | null>(initialError ?? null);
  const [pending, startTransition] = useTransition();

  const load = useCallback(() => {
    startTransition(async () => {
      try {
        const result = await loadFileDiff(workspaceId, reviewNumber, fileId, view);
        if (result.ok) {
          setDiff(result.diff);
          setError(null);
        } else {
          setError(result.error);
        }
      } catch {
        // Network errors, or an action id from an older deployment.
        setError('failed');
      }
    });
  }, [workspaceId, reviewNumber, fileId, view]);

  const loaded = diff !== null;
  useEffect(
    () => onRevealFile(fileId, () => !loaded && !pending && load()),
    [fileId, loaded, pending, load],
  );

  if (diff) return <DiffTable fileId={fileId} diff={diff} />;

  return (
    <div className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm" aria-live="polite">
      {error ? (
        <>
          <span className="text-red-300">{ERROR_TEXT[error]}</span>
          {error === 'unauthorized' ? (
            <Link href="/login" className={smallSecondaryButton}>
              Log in again
            </Link>
          ) : (
            error === 'failed' && (
              <button
                type="button"
                onClick={load}
                disabled={pending}
                className={smallSecondaryButton}
              >
                {pending ? 'Retrying…' : 'Retry'}
              </button>
            )
          )}
        </>
      ) : (
        <>
          <button type="button" onClick={load} disabled={pending} className={smallSecondaryButton}>
            {pending ? 'Loading…' : 'Load diff'}
          </button>
          <span className="text-xs text-slate-500">
            {changedLines.toLocaleString('en')} changed {changedLines === 1 ? 'line' : 'lines'}
          </span>
        </>
      )}
    </div>
  );
}
