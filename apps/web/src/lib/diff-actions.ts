'use server';

import { getReviewFileDiff } from './api.server';
import { isDiffView } from './diff-params';
import { highlightedRows, type DiffRows } from './diff-view.server';
import { isReviewNumber, isUuid } from './review-params';

export type LoadFileDiffError = 'unauthorized' | 'not_found' | 'failed';
export type LoadFileDiffResult =
  { ok: true; diff: DiffRows } | { ok: false; error: LoadFileDiffError };

/**
 * A file's highlighted diff rows, for the "Load diff" button. Reachable by anyone who can POST to
 * the page, so every argument is checked here, and the API checks access with the user's cookie.
 */
export async function loadFileDiff(
  workspaceId: unknown,
  reviewNumber: unknown,
  fileId: unknown,
  view: unknown,
): Promise<LoadFileDiffResult> {
  if (
    typeof workspaceId !== 'string' ||
    typeof reviewNumber !== 'string' ||
    typeof fileId !== 'string' ||
    !isUuid(workspaceId) ||
    !isReviewNumber(reviewNumber) ||
    !isUuid(fileId) ||
    !isDiffView(view)
  ) {
    return { ok: false, error: 'not_found' };
  }

  const result = await getReviewFileDiff(workspaceId, reviewNumber, fileId);
  if (!result.ok) {
    if (result.status === 401) return { ok: false, error: 'unauthorized' };
    if (result.status === 404) return { ok: false, error: 'not_found' };
    return { ok: false, error: 'failed' };
  }

  const { file, hunks } = result.data;
  const path = file.newPath ?? file.oldPath ?? '';
  return { ok: true, diff: await highlightedRows(path, hunks, view) };
}
