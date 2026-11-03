import type { ReviewFile } from '@diffcraft/shared';
import { DiffTable } from '@/components/diff-table';
import { getReviewFileDiff } from '@/lib/api.server';
import type { DiffView } from '@/lib/diff-params';
import { highlightedRows } from '@/lib/diff-view.server';
import { LazyFileDiff } from './lazy-file-diff';

/** A diff rendered on the server, streamed in through its own Suspense boundary. */
export async function EagerFileDiff({
  workspaceId,
  reviewNumber,
  file,
  view,
}: {
  workspaceId: string;
  reviewNumber: string;
  file: ReviewFile;
  view: DiffView;
}) {
  const result = await getReviewFileDiff(workspaceId, reviewNumber, file.id);
  if (!result.ok) {
    // The page has already started streaming, so show the error here, with Retry.
    const error =
      result.status === 401 ? 'unauthorized' : result.status === 404 ? 'not_found' : 'failed';
    return (
      <LazyFileDiff
        workspaceId={workspaceId}
        reviewNumber={reviewNumber}
        fileId={file.id}
        view={view}
        changedLines={file.additions + file.deletions}
        initialError={error}
      />
    );
  }

  const { hunks } = result.data;
  const diff = await highlightedRows(file.newPath ?? file.oldPath ?? '', hunks, view);
  return <DiffTable fileId={file.id} diff={diff} />;
}

export function DiffLoading() {
  return (
    <p role="status" className="animate-pulse px-4 py-3 text-sm text-slate-500">
      Loading diff…
    </p>
  );
}
