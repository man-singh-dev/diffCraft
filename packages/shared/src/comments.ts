import { z } from 'zod';
import { hasAtLeastRole, type WorkspaceRole } from './workspaces.ts';

export const THREAD_STATUSES = ['open', 'resolved'] as const;
export const ThreadStatusSchema = z.enum(THREAD_STATUSES);
export type ThreadStatus = z.infer<typeof ThreadStatusSchema>;

/** The side of a diff a line is on: "old" for deleted lines, "new" for added and context lines. */
export const LINE_SIDES = ['old', 'new'] as const;
export const LineSideSchema = z.enum(LINE_SIDES);

const INT4_MAX = 2_147_483_647;

export const CommentBodySchema = z
  .string()
  .trim()
  .min(1)
  .max(10_000)
  // Postgres text can't store U+0000.
  .refine((value) => !value.includes('\0'), 'Must not contain NUL characters.');

export const CommentAnchorInputSchema = z.object({
  fileId: z.uuid(),
  side: LineSideSchema,
  line: z.number().int().positive().max(INT4_MAX),
});
export type CommentAnchorInput = z.infer<typeof CommentAnchorInputSchema>;

/** A new thread with its first comment; without `anchor` it is about the review as a whole. */
export const CreateThreadRequestSchema = z.object({
  body: CommentBodySchema,
  anchor: CommentAnchorInputSchema.optional(),
});
export type CreateThreadRequest = z.infer<typeof CreateThreadRequestSchema>;

export const ReplyRequestSchema = z.object({ body: CommentBodySchema });
export type ReplyRequest = z.infer<typeof ReplyRequestSchema>;

export const EditCommentRequestSchema = z.object({ body: CommentBodySchema });
export type EditCommentRequest = z.infer<typeof EditCommentRequestSchema>;

export const SetThreadStatusRequestSchema = z.object({ status: ThreadStatusSchema });
export type SetThreadStatusRequest = z.infer<typeof SetThreadStatusRequestSchema>;

/** A user as shown next to a comment or thread; null once the account is deleted. */
const UserRefSchema = z.object({ id: z.uuid(), displayName: z.string() }).nullable();

export const CommentSchema = z.object({
  id: z.uuid(),
  threadId: z.uuid(),
  author: UserRefSchema,
  /** Empty once the comment is deleted. */
  body: z.string(),
  createdAt: z.iso.datetime(),
  edited: z.boolean(),
  deleted: z.boolean(),
});
export type Comment = z.infer<typeof CommentSchema>;

export const ThreadAnchorSchema = z.object({
  fileId: z.uuid(),
  side: LineSideSchema,
  line: z.number().int().positive(),
  /** The line's text when the thread was started, so it can be shown if the line changes later. */
  lineContent: z.string(),
});
export type ThreadAnchor = z.infer<typeof ThreadAnchorSchema>;

export const ThreadSchema = z.object({
  id: z.uuid(),
  reviewId: z.uuid(),
  /** Null for a review-level thread. */
  anchor: ThreadAnchorSchema.nullable(),
  status: ThreadStatusSchema,
  resolvedBy: UserRefSchema,
  resolvedAt: z.iso.datetime().nullable(),
  createdBy: UserRefSchema,
  createdAt: z.iso.datetime(),
  /** Oldest first; deleted comments stay in place with an empty body. */
  comments: z.array(CommentSchema),
});
export type Thread = z.infer<typeof ThreadSchema>;

// Permission rules, shared so the web UI offers only what the API allows.

/** Starting threads and replying: members and above. */
export function canComment(role: WorkspaceRole): boolean {
  return hasAtLeastRole(role, 'member');
}

/** Only the author edits a comment, and not once it is deleted: admins can't put words in others' mouths. */
export function canEditComment(
  userId: string,
  comment: Pick<Comment, 'author' | 'deleted'>,
): boolean {
  return !comment.deleted && comment.author?.id === userId;
}

/** The author (still a member or above) or any admin or owner, unless already deleted. */
export function canDeleteComment(
  role: WorkspaceRole,
  userId: string,
  comment: Pick<Comment, 'author' | 'deleted'>,
): boolean {
  if (comment.deleted) return false;
  if (hasAtLeastRole(role, 'admin')) return true;
  return hasAtLeastRole(role, 'member') && comment.author?.id === userId;
}

/** Members and above who started the thread or wrote the review, and any admin or owner. */
export function canResolveThread(
  role: WorkspaceRole,
  userId: string,
  thread: Pick<Thread, 'createdBy'>,
  reviewAuthorId: string | null,
): boolean {
  if (!hasAtLeastRole(role, 'member')) return false;
  if (hasAtLeastRole(role, 'admin')) return true;
  return thread.createdBy?.id === userId || reviewAuthorId === userId;
}
