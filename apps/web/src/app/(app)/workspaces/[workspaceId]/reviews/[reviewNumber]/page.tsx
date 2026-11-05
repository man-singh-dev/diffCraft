import { canEditReview } from '@diffcraft/shared';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { FormError } from '@/components/form-field';
import { PageCard } from '@/components/page-card';
import {
  authorName,
  ChangeTypeBadge,
  CreatedDate,
  filePath,
  LineCounts,
  StatusBadge,
} from '@/components/review-ui';
import { textLink } from '@/components/styles';
import { CommentsProvider } from '@/components/comments-provider';
import {
  OpenThreadCount,
  OpenThreadsSummary,
  ReviewConversation,
} from '@/components/review-conversation';
import { getReview, getReviewFiles, getThreads, getWorkspace } from '@/lib/api.server';
import { fileSectionId } from '@/lib/diff-params';
import { getCurrentUser } from '@/lib/auth.server';
import { ReviewControls } from './review-controls';

export const metadata: Metadata = { title: 'Review · DiffCraft' };

const sectionHeading = 'text-sm font-semibold text-slate-200';

export default async function ReviewPage(
  props: PageProps<'/workspaces/[workspaceId]/reviews/[reviewNumber]'>,
) {
  const { workspaceId, reviewNumber } = await props.params;
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
  // Threads failing on their own still shows the review, with commenting off.
  if (!workspace.ok || !review.ok || !files.ok) {
    return (
      <PageCard title="Review" description="Something went wrong.">
        <FormError>Couldn&apos;t load this review. Please try again in a moment.</FormError>
      </PageCard>
    );
  }

  const r = review.data;
  // The API enforces this; the UI only hides what would be refused.
  const editable = canEditReview(workspace.data.role, user.id, r);
  const filesHref = `/workspaces/${workspaceId}/reviews/${r.number}/files`;
  const filePaths = Object.fromEntries(files.data.map((file) => [file.id, filePath(file)]));

  return (
    <PageCard wide title={`#${r.number} ${r.title}`} description={`In ${workspace.data.name}.`}>
      <CommentsProvider
        workspaceId={workspaceId}
        reviewNumber={reviewNumber}
        viewer={{ userId: user.id, role: workspace.data.role }}
        reviewAuthorId={r.author?.id ?? null}
        initialThreads={threads.ok ? threads.data : null}
      >
        <Link href={`/workspaces/${workspaceId}/reviews`} className={`${textLink} text-sm`}>
          ← All reviews
        </Link>

        <dl className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border border-slate-800 bg-slate-950/40 p-4 text-sm">
          <div className="flex items-center gap-2">
            <dt className="sr-only">Status</dt>
            <dd>
              <StatusBadge status={r.status} />
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-slate-500">Author</dt>
            <dd className="text-slate-200">{authorName(r)}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-slate-500">Created</dt>
            <dd className="text-slate-200">
              <CreatedDate value={r.createdAt} />
            </dd>
          </div>
          <div className="flex items-center gap-2">
            <dt className="text-slate-500">Changes</dt>
            <dd className="text-slate-200">
              {r.filesChanged} {r.filesChanged === 1 ? 'file' : 'files'}{' '}
              <LineCounts additions={r.additions} deletions={r.deletions} />
            </dd>
          </div>
        </dl>

        <section aria-labelledby="description" className="space-y-2">
          <h2 id="description" className={sectionHeading}>
            Description
          </h2>
          {r.description ? (
            // Plain text: React escapes it, and line breaks are kept by CSS, not by markup.
            <p className="whitespace-pre-wrap break-words text-sm text-slate-300">
              {r.description}
            </p>
          ) : (
            <p className="text-sm text-slate-500">No description.</p>
          )}
        </section>

        {editable && (
          <ReviewControls
            // Remount after a save, so the edit form starts from the saved values.
            key={`${r.title}\n${r.description ?? ''}\n${r.status}`}
            workspaceId={workspaceId}
            review={r}
          />
        )}

        <section aria-labelledby="files" className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="files" className={sectionHeading}>
              Files ({files.data.length})
            </h2>
            {files.data.length > 0 && (
              <Link href={filesHref} className={`${textLink} text-sm`}>
                Files changed ({files.data.length}) →
                <OpenThreadCount />
              </Link>
            )}
          </div>
          {files.data.length === 0 ? (
            <p className="text-sm text-slate-500">This patch changes no files.</p>
          ) : (
            <ul className="divide-y divide-slate-800 rounded-xl border border-slate-800">
              {files.data.map((file) => (
                <li key={file.id}>
                  <Link
                    href={`${filesHref}#${fileSectionId(file.id)}`}
                    className="flex flex-wrap items-center gap-2 px-4 py-2.5 hover:bg-slate-800/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-violet-400"
                  >
                    <ChangeTypeBadge changeType={file.changeType} />
                    {file.isBinary && (
                      <span className="rounded-full border border-amber-800 px-2 py-0.5 text-xs text-amber-300">
                        binary
                      </span>
                    )}
                    <span className="min-w-0 flex-1 break-all font-mono text-xs text-slate-200">
                      {filePath(file)}
                    </span>
                    <LineCounts additions={file.additions} deletions={file.deletions} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <OpenThreadsSummary filesHref={filesHref} filePaths={filePaths} />
        </section>

        <section aria-labelledby="conversation" className="space-y-3">
          <h2 id="conversation" className={sectionHeading}>
            Conversation
          </h2>
          <ReviewConversation />
        </section>
      </CommentsProvider>
    </PageCard>
  );
}
