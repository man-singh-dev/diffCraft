'use client';

import { canComment, canResolveThread, type Thread } from '@diffcraft/shared';
import { useState } from 'react';
import { CommentComposer } from './comment-composer';
import { CommentItem } from './comment-item';
import { useComments } from './comments-provider';
import { smallSecondaryButton } from './styles';

const linkButton =
  'text-xs font-medium text-violet-400 hover:text-violet-300 focus-visible:outline-none focus-visible:underline disabled:opacity-60';

export const threadElementId = (threadId: string) => `thread-${threadId}`;

export function CommentThread({ thread }: { thread: Thread }) {
  const comments = useComments();
  const [expanded, setExpanded] = useState(false);
  const [replying, setReplying] = useState(false);
  const [statusPending, setStatusPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!comments) return null;
  const { viewer, reviewAuthorId, reply, setStatus } = comments;
  const resolved = thread.status === 'resolved';
  const mayReply = canComment(viewer.role);
  const mayResolve = canResolveThread(viewer.role, viewer.userId, thread, reviewAuthorId);
  const count = thread.comments.length;

  async function toggleStatus() {
    setStatusPending(true);
    setError(null);
    const failure = await setStatus(thread.id, resolved ? 'open' : 'resolved');
    setStatusPending(false);
    if (failure) setError(failure.message);
    setExpanded(false);
  }

  const shell = 'scroll-mt-16 rounded-lg border border-slate-800 bg-slate-900 font-sans';

  if (resolved && !expanded) {
    return (
      <div
        id={threadElementId(thread.id)}
        className={`${shell} flex flex-wrap items-center gap-2 px-3 py-2 text-xs text-slate-400`}
      >
        <span>
          Resolved thread · {count} {count === 1 ? 'comment' : 'comments'}
        </span>
        <button
          type="button"
          onClick={() => setExpanded(true)}
          aria-expanded={false}
          className={linkButton}
        >
          Show
        </button>
      </div>
    );
  }

  return (
    <div id={threadElementId(thread.id)} className={`${shell} space-y-3 p-3`}>
      {resolved && (
        <p className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
          <span className="rounded-full border border-emerald-800 px-2 py-0.5 text-emerald-300">
            Resolved
          </span>
          {thread.resolvedBy && <span>Resolved by {thread.resolvedBy.displayName}</span>}
          <button
            type="button"
            onClick={() => setExpanded(false)}
            aria-expanded
            className={linkButton}
          >
            Hide
          </button>
        </p>
      )}

      <ul className="divide-y divide-slate-800">
        {thread.comments.map((comment) => (
          <CommentItem
            key={comment.id}
            threadId={thread.id}
            anchor={thread.anchor}
            comment={comment}
          />
        ))}
      </ul>

      {replying ? (
        <CommentComposer
          label="Reply"
          submitLabel="Reply"
          placeholder="Write a reply"
          autoFocus
          suggestionLine={thread.anchor?.side === 'new' ? thread.anchor.lineContent : undefined}
          onSubmit={async (body) => {
            const failure = await reply(thread.id, body);
            if (!failure) setReplying(false);
            return failure;
          }}
          onCancel={() => setReplying(false)}
        />
      ) : (
        (mayReply || mayResolve) && (
          <div className="flex flex-wrap items-center gap-2">
            {mayReply && (
              <button
                type="button"
                onClick={() => setReplying(true)}
                className={smallSecondaryButton}
              >
                Reply
              </button>
            )}
            {mayResolve && (
              <button
                type="button"
                onClick={toggleStatus}
                disabled={statusPending}
                className={smallSecondaryButton}
              >
                {resolved ? 'Reopen' : 'Resolve'}
              </button>
            )}
          </div>
        )
      )}
      {error && (
        <p role="alert" className="text-xs text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
