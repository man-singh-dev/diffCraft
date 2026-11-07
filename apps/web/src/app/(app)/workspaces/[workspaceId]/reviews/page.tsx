import { hasAtLeastRole } from '@diffcraft/shared';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { FormError } from '@/components/form-field';
import { PageCard } from '@/components/page-card';
import { ReviewRow } from '@/components/review-ui';
import { primaryButton, textLink } from '@/components/styles';
import { getReviews, getWorkspace } from '@/lib/api.server';
import { parseReviewFilters, reviewsPageHref, type ReviewFilters } from '@/lib/review-params';
import { LoadMoreReviews } from './load-more-reviews';

export const metadata: Metadata = { title: 'Reviews · DiffCraft' };

const TABS: readonly { label: string; status: ReviewFilters['status'] }[] = [
  { label: 'All', status: null },
  { label: 'Open', status: 'open' },
  { label: 'Closed', status: 'closed' },
  { label: 'Merged', status: 'merged' },
];

const tabClass =
  'rounded-md px-3 py-1.5 text-sm font-medium text-slate-400 transition hover:bg-slate-800 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 aria-[current=page]:bg-slate-800 aria-[current=page]:text-white';

export default async function ReviewsPage(props: PageProps<'/workspaces/[workspaceId]/reviews'>) {
  const [{ workspaceId }, searchParams] = await Promise.all([props.params, props.searchParams]);
  const filters = parseReviewFilters(searchParams);
  const [workspace, reviews] = await Promise.all([
    getWorkspace(workspaceId),
    getReviews(workspaceId, filters),
  ]);

  if ([workspace, reviews].some((r) => !r.ok && r.status === 401)) redirect('/login');
  if ([workspace, reviews].some((r) => !r.ok && r.status === 404)) notFound();
  if (!workspace.ok || !reviews.ok) {
    return (
      <PageCard title="Reviews" description="Something went wrong.">
        <FormError>Couldn&apos;t load the reviews. Please try again in a moment.</FormError>
      </PageCard>
    );
  }

  const canCreate = hasAtLeastRole(workspace.data.role, 'member');
  const newHref = `/workspaces/${workspaceId}/reviews/new`;
  const filtered = filters.status !== null || filters.mine || filters.reviewing;

  return (
    <PageCard wide title="Reviews" description={`Code reviews in ${workspace.data.name}.`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href={`/workspaces/${workspaceId}`} className={`${textLink} text-sm`}>
          ← Workspace
        </Link>
        {canCreate && (
          <Link href={newHref} className={`${primaryButton} w-auto`}>
            New review
          </Link>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Filter by status" className="flex gap-1">
          {TABS.map(({ label, status }) => (
            <Link
              key={label}
              href={reviewsPageHref(workspaceId, { ...filters, status })}
              aria-current={filters.status === status ? 'page' : undefined}
              className={tabClass}
            >
              {label}
            </Link>
          ))}
        </nav>
        <div className="flex flex-wrap gap-1">
          <Link
            href={reviewsPageHref(workspaceId, { ...filters, reviewing: !filters.reviewing })}
            aria-current={filters.reviewing ? 'page' : undefined}
            className={tabClass}
          >
            {filters.reviewing ? '✓ ' : ''}Waiting for my review
          </Link>
          <Link
            href={reviewsPageHref(workspaceId, { ...filters, mine: !filters.mine })}
            aria-current={filters.mine ? 'page' : undefined}
            className={tabClass}
          >
            {filters.mine ? '✓ ' : ''}Only mine
          </Link>
        </div>
      </div>

      {reviews.data.items.length === 0 ? (
        <div className="space-y-3 rounded-xl border border-dashed border-slate-700 p-6 text-center text-sm text-slate-400">
          <p>{filtered ? 'No reviews match these filters.' : 'No reviews yet.'}</p>
          {canCreate && (
            <Link href={newHref} className={textLink}>
              New review
            </Link>
          )}
        </div>
      ) : (
        <LoadMoreReviews
          // A new filter starts a new list, without the pages loaded for the old one.
          key={reviewsPageHref(workspaceId, filters)}
          workspaceId={workspaceId}
          filters={filters}
          nextCursor={reviews.data.nextCursor}
        >
          {reviews.data.items.map((review) => (
            <ReviewRow key={review.id} review={review} />
          ))}
        </LoadMoreReviews>
      )}
    </PageCard>
  );
}
