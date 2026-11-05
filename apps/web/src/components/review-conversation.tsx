'use client';

import { canComment, lineAnchor } from '@diffcraft/shared';
import Link from 'next/link';
import { openLineThreads } from '@/lib/thread-anchors';
import { CommentComposer } from './comment-composer';
import { CommentThread } from './comment-thread';
import { useComments } from './comments-provider';
import { textLink } from './styles';

export function ReviewConversation() {
  const comments = useComments();
  if (!comments) return null;
  const reviewThreads = comments.threads.filter((t) => t.anchor === null);

  return (
    <div className="space-y-3">
      {comments.loadFailed ? (
        <p className="text-sm text-amber-300">
          Comments couldn&apos;t be loaded. Reload the page to try again.
        </p>
      ) : reviewThreads.length === 0 ? (
        <p className="text-sm text-slate-500">No comments on the review yet.</p>
      ) : (
        reviewThreads.map((thread) => <CommentThread key={thread.id} thread={thread} />)
      )}
      {!comments.loadFailed && canComment(comments.viewer.role) && (
        <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
          <CommentComposer
            label="Leave a comment"
            submitLabel="Comment"
            placeholder="Leave a comment on the review"
            onSubmit={(body) => comments.startThread(null, body)}
          />
        </div>
      )}
    </div>
  );
}

export function OpenThreadsSummary({
  filesHref,
  filePaths,
}: {
  filesHref: string;
  filePaths: Record<string, string>;
}) {
  const comments = useComments();
  if (!comments || comments.loadFailed) return null;
  const open = openLineThreads(comments.threads);
  if (open.length === 0)
    return <p className="text-sm text-slate-500">No open threads on the code.</p>;

  return (
    <div className="space-y-2">
      <p className="text-sm text-slate-300">
        {open.length} open {open.length === 1 ? 'thread' : 'threads'} on the code
      </p>
      <ul className="space-y-1">
        {open.map((thread) => {
          const { fileId, side, line } = thread.anchor!;
          const first = thread.comments[0];
          return (
            <li key={thread.id} className="flex flex-wrap items-baseline gap-x-2 text-sm">
              <Link href={`${filesHref}#${lineAnchor(fileId, side, line)}`} className={textLink}>
                <span className="font-mono text-xs">
                  {filePaths[fileId] ?? 'Unknown file'}:{line}
                </span>
                {side === 'old' && <span className="ml-1 text-xs text-slate-500">(old)</span>}
              </Link>
              {first && (
                <span className="min-w-0 truncate text-xs text-slate-500">
                  {first.deleted ? 'Deleted comment' : first.body}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function OpenThreadCount() {
  const comments = useComments();
  if (!comments || comments.loadFailed) return null;
  const count = openLineThreads(comments.threads).length;
  if (count === 0) return null;
  return (
    <span className="ml-2 rounded-full border border-violet-800 bg-violet-950/60 px-2 py-0.5 text-xs text-violet-200">
      {count} open
    </span>
  );
}
