import type { ReviewFile } from '@diffcraft/shared';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Suspense } from 'react';
import { FormError } from '@/components/form-field';
import { PageCard } from '@/components/page-card';
import { ChangeTypeBadge, filePath, LineCounts, StatusBadge } from '@/components/review-ui';
import { textLink } from '@/components/styles';
import { CommentsProvider } from '@/components/comments-provider';
import { LiveStatus, ReviewDeletedBanner } from '@/components/review-live';
import { getReview, getReviewFiles, getThreads, getWorkspace } from '@/lib/api.server';
import { getCurrentUser } from '@/lib/auth.server';
import {
  DIFF_VIEWS,
  eagerFileIds,
  fileSectionId,
  filesPageHref,
  parseDiffView,
  type DiffView,
} from '@/lib/diff-params';
import { DiffLoading, EagerFileDiff } from './eager-file-diff';
import { FileSection } from './file-section';
import { HashTarget } from './hash-target';
import { LazyFileDiff } from './lazy-file-diff';

export const metadata: Metadata = { title: 'Files changed · DiffCraft' };

const VIEW_LABELS: Record<DiffView, string> = { unified: 'Unified', split: 'Split' };

const toggleClass =
  'rounded-md px-3 py-1.5 text-sm font-medium text-slate-400 transition hover:bg-slate-800 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 aria-[current=page]:bg-slate-800 aria-[current=page]:text-white';

const note = 'px-4 py-3 text-sm text-slate-500';

export default async function FilesChangedPage(
  props: PageProps<'/workspaces/[workspaceId]/reviews/[reviewNumber]/files'>,
) {
  const [{ workspaceId, reviewNumber }, searchParams] = await Promise.all([
    props.params,
    props.searchParams,
  ]);
  const view = parseDiffView(searchParams);
  const loadedAt = new Date().toISOString();
  const [user, workspace, review, files, threads] = await Promise.all([
    getCurrentUser(),
    getWorkspace(workspaceId),
    getReview(workspaceId, reviewNumber),
    getReviewFiles(workspaceId, reviewNumber),
    getThreads(workspaceId, reviewNumber),
  ]);

  const results = [workspace, review, files, threads];
  if (!user || results.some((r) => !r.ok && r.status === 401)) redirect('/login');
  if (results.some((r) => !r.ok && r.status === 404)) notFound();
  // Threads failing on their own still shows the diffs, with commenting off.
  if (!workspace.ok || !review.ok || !files.ok) {
    return (
      <PageCard title="Files changed" description="Something went wrong.">
        <FormError>Couldn&apos;t load this review. Please try again in a moment.</FormError>
      </PageCard>
    );
  }

  const r = review.data;
  const eager = eagerFileIds(files.data);

  function fileBody(file: ReviewFile) {
    if (file.isBinary) return <p className={note}>Binary file not shown.</p>;
    if (file.additions + file.deletions === 0) return <p className={note}>No content changes.</p>;
    if (eager.has(file.id)) {
      return (
        <Suspense fallback={<DiffLoading />}>
          <EagerFileDiff
            workspaceId={workspaceId}
            reviewNumber={reviewNumber}
            file={file}
            view={view}
          />
        </Suspense>
      );
    }
    return (
      <LazyFileDiff
        // Remount when the view changes, so a loaded diff isn't shown in the old view.
        key={view}
        workspaceId={workspaceId}
        reviewNumber={reviewNumber}
        fileId={file.id}
        view={view}
        changedLines={file.additions + file.deletions}
      />
    );
  }

  return (
    <CommentsProvider
      workspaceId={workspaceId}
      reviewNumber={reviewNumber}
      viewer={{ userId: user.id, role: workspace.data.role }}
      reviewAuthorId={r.author?.id ?? null}
      initialThreads={threads.ok ? threads.data : null}
      loadedAt={loadedAt}
    >
      <main className="mx-auto w-full max-w-screen-2xl flex-1 space-y-6 px-4 py-8">
        <HashTarget />
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0 space-y-2">
            <Link
              href={`/workspaces/${workspaceId}/reviews/${r.number}`}
              className={`${textLink} text-sm`}
            >
              ← Back to the review
            </Link>
            <h1 className="flex flex-wrap items-center gap-3 break-words text-2xl font-bold tracking-tight text-slate-100">
              <span>
                <span className="mr-2 font-mono text-slate-500">#{r.number}</span>
                {r.title}
              </span>
              <StatusBadge status={r.status} />
              <LiveStatus />
            </h1>
            <p className="flex flex-wrap items-center gap-2 text-sm text-slate-400">
              Files changed ({files.data.length})
              <LineCounts additions={r.additions} deletions={r.deletions} />
            </p>
            {!threads.ok && (
              <p className="text-sm text-amber-300">
                Comments couldn&apos;t be loaded, so commenting is off. Reload the page to try
                again.
              </p>
            )}
          </div>
          <nav aria-label="Diff view" className="flex gap-1 rounded-lg border border-slate-800 p-1">
            {DIFF_VIEWS.map((v) => (
              <Link
                key={v}
                href={filesPageHref(workspaceId, r.number, searchParams, v)}
                aria-current={v === view ? 'page' : undefined}
                className={toggleClass}
                scroll={false}
              >
                {VIEW_LABELS[v]}
              </Link>
            ))}
          </nav>
        </div>

        <ReviewDeletedBanner />

        {files.data.length === 0 ? (
          <p className="text-sm text-slate-500">This patch changes no files.</p>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[18rem_minmax(0,1fr)]">
            <nav
              aria-label="Files"
              className="lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:self-start lg:overflow-y-auto"
            >
              <ul className="divide-y divide-slate-800 rounded-xl border border-slate-800 bg-slate-900">
                {files.data.map((file) => (
                  <li key={file.id}>
                    <a
                      href={`#${fileSectionId(file.id)}`}
                      className="flex flex-wrap items-center gap-2 px-3 py-2 hover:bg-slate-800/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-violet-400"
                    >
                      <ChangeTypeBadge changeType={file.changeType} />
                      <span className="min-w-0 flex-1 break-all font-mono text-xs text-slate-200">
                        {filePath(file)}
                      </span>
                      <LineCounts additions={file.additions} deletions={file.deletions} />
                    </a>
                  </li>
                ))}
              </ul>
            </nav>

            <div className="min-w-0 space-y-4">
              {files.data.map((file) => (
                <FileSection key={file.id} file={file}>
                  {fileBody(file)}
                </FileSection>
              ))}
            </div>
          </div>
        )}
      </main>
    </CommentsProvider>
  );
}
