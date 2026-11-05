'use client';

import { canComment } from '@diffcraft/shared';
import { targetKey, type LineTarget } from '@/lib/thread-anchors';
import { CommentComposer } from './comment-composer';
import { CommentThread } from './comment-thread';
import { useComments } from './comments-provider';

// Client islands inside the hook-free DiffTable. Outside a CommentsProvider they render nothing.

export function AddCommentButton({ target, className }: { target: LineTarget; className: string }) {
  const comments = useComments();
  if (!comments || comments.loadFailed || !canComment(comments.viewer.role)) return null;
  return (
    <button
      type="button"
      aria-label={`Add a comment on line ${target.line}`}
      onClick={() => comments.openComposer(target)}
      className={`absolute inset-0 m-auto flex size-4 items-center justify-center rounded bg-violet-600 text-xs font-bold leading-none text-white opacity-0 transition focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300 ${className}`}
    >
      +
    </button>
  );
}

function LineConversation({
  keys,
  target,
  lineContent,
}: {
  keys: string[];
  target: LineTarget | null;
  lineContent: string;
}) {
  const comments = useComments();
  if (!comments) return null;
  const threads = comments.threadsForKeys(keys);
  const { composer } = comments;
  const composing =
    target !== null && composer !== null && targetKey(composer) === targetKey(target);
  if (threads.length === 0 && !composing) return null;

  return (
    <div className="space-y-2 whitespace-normal p-2">
      {threads.map((thread) => (
        <CommentThread key={thread.id} thread={thread} />
      ))}
      {composing && target && (
        <div className="rounded-lg border border-slate-800 bg-slate-900 p-3">
          <CommentComposer
            label={`Comment on line ${target.line}`}
            submitLabel="Comment"
            placeholder="Leave a comment"
            autoFocus
            suggestionLine={target.side === 'new' ? lineContent : undefined}
            onSubmit={(body) => comments.startThread(target, body)}
            onCancel={() => comments.openComposer(null)}
          />
        </div>
      )}
    </div>
  );
}

function hasConversation(
  comments: NonNullable<ReturnType<typeof useComments>>,
  keys: string[],
  target: LineTarget | null,
): boolean {
  const { composer } = comments;
  const composing =
    target !== null && composer !== null && targetKey(composer) === targetKey(target);
  return composing || comments.threadsForKeys(keys).length > 0;
}

export function UnifiedThreadsRow({
  keys,
  target,
  lineContent,
  colSpan,
}: {
  keys: string[];
  target: LineTarget | null;
  lineContent: string;
  colSpan: number;
}) {
  const comments = useComments();
  if (!comments || !hasConversation(comments, keys, target)) return null;
  return (
    <tr>
      <td colSpan={colSpan} className="border-y border-slate-800 bg-slate-950/60">
        <LineConversation keys={keys} target={target} lineContent={lineContent} />
      </td>
    </tr>
  );
}

interface SplitSide {
  keys: string[];
  target: LineTarget;
  lineContent: string;
}

export function SplitThreadsRow({
  left,
  right,
  halfSpan,
}: {
  left: SplitSide | null;
  right: SplitSide | null;
  halfSpan: number;
}) {
  const comments = useComments();
  if (!comments) return null;
  const leftShown = left !== null && hasConversation(comments, left.keys, left.target);
  const rightShown = right !== null && hasConversation(comments, right.keys, right.target);
  if (!leftShown && !rightShown) return null;
  return (
    <tr>
      <td colSpan={halfSpan} className="border-y border-slate-800 bg-slate-950/60 align-top">
        {leftShown && <LineConversation {...left} />}
      </td>
      <td colSpan={halfSpan} className="border-y border-slate-800 bg-slate-950/60 align-top">
        {rightShown && <LineConversation {...right} />}
      </td>
    </tr>
  );
}
