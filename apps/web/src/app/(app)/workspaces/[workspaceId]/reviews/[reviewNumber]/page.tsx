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
import { getReview, getReviewFiles, getWorkspace } from '@/lib/api.server';
import { getCurrentUser } from '@/lib/auth.server';
import { ReviewControls } from './review-controls';

export const metadata: Metadata = { title: 'Review · DiffCraft' };

const sectionHeading = 'text-sm font-semibold text-slate-200';

export default async function ReviewPage(
  props: PageProps<'/workspaces/[workspaceId]/reviews/[reviewNumber]'>,
) {
  const { workspaceId, reviewNumber } = await props.params;
  const [user, workspace, review, files] = await Promise.all([
    getCurrentUser(),
    getWorkspace(workspaceId),
    getReview(workspaceId, reviewNumber),
    getReviewFiles(workspaceId, reviewNumber),
  ]);

  const results = [workspace, review, files];
  if (!user || results.some((r) => !r.ok && r.status === 401)) redirect('/login');
  if (results.some((r) => !r.ok && r.status === 404)) notFound();
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

  return (
    <PageCard wide title={`#${r.number} ${r.title}`} description={`In ${workspace.data.name}.`}>
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
          <p className="whitespace-pre-wrap break-words text-sm text-slate-300">{r.description}</p>
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
        <h2 id="files" className={sectionHeading}>
          Files ({files.data.length})
        </h2>
        {files.data.length === 0 ? (
          <p className="text-sm text-slate-500">This patch changes no files.</p>
        ) : (
          <ul className="divide-y divide-slate-800 rounded-xl border border-slate-800">
            {files.data.map((file) => (
              <li key={file.id} className="flex flex-wrap items-center gap-2 px-4 py-2.5">
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
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-slate-500">
          The diff viewer for each file comes in a later version.
        </p>
      </section>
    </PageCard>
  );
}
