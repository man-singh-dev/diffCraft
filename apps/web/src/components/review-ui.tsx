import type { Review, ReviewFile, ReviewStatus } from '@diffcraft/shared';
import Link from 'next/link';

// Shared by server pages and the client "Load more" list, so no hooks and no server-only code.

// UTC so the date doesn't depend on the server's (or browser's) time zone.
const createdDate = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeZone: 'UTC' });

export function CreatedDate({ value }: { value: string }) {
  return <time dateTime={value}>{createdDate.format(new Date(value))}</time>;
}

const badge = 'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium';

const STATUS_COLORS: Record<ReviewStatus, string> = {
  open: 'border-emerald-700 bg-emerald-950/60 text-emerald-200',
  closed: 'border-slate-600 bg-slate-800/60 text-slate-300',
  merged: 'border-violet-700 bg-violet-950/60 text-violet-200',
};

const STATUS_LABELS: Record<ReviewStatus, string> = {
  open: 'Open',
  closed: 'Closed',
  merged: 'Merged',
};

export function StatusBadge({ status }: { status: ReviewStatus }) {
  return <span className={`${badge} ${STATUS_COLORS[status]}`}>{STATUS_LABELS[status]}</span>;
}

const CHANGE_COLORS: Record<ReviewFile['changeType'], string> = {
  added: 'border-emerald-800 text-emerald-300',
  deleted: 'border-red-800 text-red-300',
  modified: 'border-slate-600 text-slate-300',
  renamed: 'border-indigo-700 text-indigo-300',
};

export function ChangeTypeBadge({ changeType }: { changeType: ReviewFile['changeType'] }) {
  return <span className={`${badge} ${CHANGE_COLORS[changeType]}`}>{changeType}</span>;
}

export function LineCounts({ additions, deletions }: { additions: number; deletions: number }) {
  return (
    <span className="font-mono text-xs">
      <span className="text-emerald-400">+{additions}</span>{' '}
      <span className="text-red-400">−{deletions}</span>
    </span>
  );
}

export const authorName = (review: Pick<Review, 'author'>) =>
  review.author?.displayName ?? 'Deleted user';

export function filePath(file: Pick<ReviewFile, 'oldPath' | 'newPath' | 'changeType'>): string {
  if (file.changeType === 'renamed' && file.oldPath && file.newPath) {
    return `${file.oldPath} → ${file.newPath}`;
  }
  return file.newPath ?? file.oldPath ?? '(unknown path)';
}

export function ReviewRow({ review }: { review: Review }) {
  return (
    <li className="space-y-1 px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <Link
          href={`/workspaces/${review.workspaceId}/reviews/${review.number}`}
          className="min-w-0 break-words text-sm font-medium text-slate-100 hover:text-violet-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
        >
          <span className="mr-1.5 font-mono text-slate-500">#{review.number}</span>
          {review.title}
        </Link>
        <StatusBadge status={review.status} />
      </div>
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400">
        <span>{authorName(review)}</span>
        <span>
          {review.filesChanged} {review.filesChanged === 1 ? 'file' : 'files'}
        </span>
        <LineCounts additions={review.additions} deletions={review.deletions} />
        <CreatedDate value={review.createdAt} />
      </p>
    </li>
  );
}
