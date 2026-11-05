'use client';

import { canComment } from '@diffcraft/shared';
import { targetKey, type LineTarget } from '@/lib/thread-anchors';
import { CommentComposer } from './comment-composer';
import { CommentThread } from './comment-thread';
import { useComments } from './comments-provider';

// Client islands inside the hook-free DiffTable. Outside a CommentsProvider they render nothing,
// so a diff can still be rendered on its own.

/** The "+" that opens a composer under a line; shown on row hover and keyboard focus. */
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

/** The threads of one side of a line, and its composer when open. Null when there's neither. */
function LineConversation({ keys, target }: { keys: string[]; target: LineTarget | null }) {
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

/** A full-width row under a unified line with its threads (and composer); nothing if there are none. */
export function UnifiedThreadsRow({
  keys,
  target,
  colSpan,
}: {
  keys: string[];
  target: LineTarget | null;
  colSpan: number;
}) {
  const comments = useComments();
  if (!comments || !hasConversation(comments, keys, target)) return null;
  return (
    <tr>
      <td colSpan={colSpan} className="border-y border-slate-800 bg-slate-950/60">
        <LineConversation keys={keys} target={target} />
      </td>
    </tr>
  );
}

interface SplitSide {
  keys: string[];
  target: LineTarget;
}

/** A row under a split line: each side's threads under its own half; nothing if neither has any. */
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
        {leftShown && <LineConversation keys={left.keys} target={left.target} />}
      </td>
      <td colSpan={halfSpan} className="border-y border-slate-800 bg-slate-950/60 align-top">
        {rightShown && <LineConversation keys={right.keys} target={right.target} />}
      </td>
    </tr>
  );
}
