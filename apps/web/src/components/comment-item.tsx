'use client';

import {
  canDeleteComment,
  canEditComment,
  type Comment,
  type ThreadAnchor,
} from '@diffcraft/shared';
import { useState } from 'react';
import { suggestionPatchUrl } from '@/lib/api-client';
import { CommentBody } from './comment-body';
import { CommentComposer } from './comment-composer';
import { useComments } from './comments-provider';
import { LocalTime } from './local-time';
import { smallDangerButton } from './styles';

const linkButton =
  'text-xs font-medium text-slate-400 hover:text-slate-100 focus-visible:outline-none focus-visible:underline disabled:opacity-60';

export function CommentItem({
  threadId,
  anchor,
  comment,
}: {
  threadId: string;
  anchor: ThreadAnchor | null;
  comment: Comment;
}) {
  const comments = useComments();
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!comments) return null;
  const { viewer, edit, remove } = comments;
  const mayEdit = canEditComment(viewer.userId, comment);
  const mayDelete = canDeleteComment(viewer.role, viewer.userId, comment);

  async function handleDelete() {
    setDeleting(true);
    setError(null);
    const failure = await remove(threadId, comment.id);
    setDeleting(false);
    setConfirmingDelete(false);
    if (failure) setError(failure.message);
  }

  return (
    <li className="space-y-1.5 py-2.5 first:pt-0 last:pb-0">
      <p className="flex flex-wrap items-baseline gap-x-2 text-xs text-slate-400">
        <span className="font-semibold text-slate-200">
          {comment.author?.displayName ?? 'Deleted user'}
        </span>
        <LocalTime iso={comment.createdAt} />
        {comment.edited && <span className="text-slate-500">(edited)</span>}
      </p>

      {comment.deleted ? (
        <p className="text-sm italic text-slate-500">This comment was deleted.</p>
      ) : editing ? (
        <CommentComposer
          label="Edit comment"
          submitLabel="Save"
          initialValue={comment.body}
          autoFocus
          onSubmit={async (body) => {
            const failure = await edit(threadId, comment.id, body);
            if (!failure) setEditing(false);
            return failure;
          }}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <CommentBody
          body={comment.body}
          anchor={anchor}
          downloadUrl={suggestionPatchUrl(
            comments.workspaceId,
            comments.reviewNumber,
            threadId,
            comment.id,
          )}
        />
      )}

      {!comment.deleted && !editing && (mayEdit || mayDelete) && (
        <div className="flex flex-wrap items-center gap-3">
          {mayEdit && (
            <button type="button" onClick={() => setEditing(true)} className={linkButton}>
              Edit
            </button>
          )}
          {mayDelete &&
            (confirmingDelete ? (
              <span className="flex items-center gap-2 text-xs text-slate-300">
                Delete this comment?
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={deleting}
                  className={smallDangerButton}
                >
                  {deleting ? 'Deleting…' : 'Delete'}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingDelete(false)}
                  disabled={deleting}
                  className={linkButton}
                >
                  Cancel
                </button>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmingDelete(true)}
                className={linkButton}
              >
                Delete
              </button>
            ))}
        </div>
      )}
      {error && (
        <p role="alert" className="text-xs text-red-400">
          {error}
        </p>
      )}
    </li>
  );
}
