'use server';

import {
  CreateThreadRequestSchema,
  EditCommentRequestSchema,
  ReplyRequestSchema,
  SetThreadStatusRequestSchema,
  type Comment,
  type Thread,
} from '@diffcraft/shared';
import {
  deleteCommentRequest,
  getThreads,
  patchComment,
  patchThreadStatus,
  postReply,
  postThread,
  type ServerSendResult,
} from './api.server';
import { NOT_FOUND_ERROR, toCommentError, type CommentActionResult } from './comment-errors';
import { validateForm } from './form-errors';
import { isReviewNumber, isUuid } from './review-params';

// Public endpoints callable with any arguments: every argument is checked here; the API checks access with the user's cookie.

const isId = (value: unknown): value is string => typeof value === 'string' && isUuid(value);
const isNumber = (value: unknown): value is string =>
  typeof value === 'string' && isReviewNumber(value);

const invalidBody = (bodyError: string | undefined) => ({
  ok: false as const,
  error: {
    code: 'invalid' as const,
    message: bodyError ?? 'Check your comment and try again.',
    ...(bodyError && { bodyError }),
  },
});

function fromApi<T>(result: ServerSendResult<T>): CommentActionResult<T> {
  return result.ok ? result : { ok: false, error: toCommentError(result) };
}

export async function createThread(
  workspaceId: unknown,
  reviewNumber: unknown,
  input: unknown,
): Promise<CommentActionResult<Thread>> {
  if (!isId(workspaceId) || !isNumber(reviewNumber)) return { ok: false, error: NOT_FOUND_ERROR };
  const parsed = validateForm(CreateThreadRequestSchema, input);
  if (!parsed.success) {
    const anchorError = Object.keys(parsed.fieldErrors).some((field) => field.startsWith('anchor'));
    if (anchorError)
      return { ok: false, error: { code: 'invalid', message: "You can't comment on that line." } };
    return invalidBody(parsed.fieldErrors.body);
  }
  return fromApi(await postThread(workspaceId, reviewNumber, parsed.data));
}

export async function replyToThread(
  workspaceId: unknown,
  reviewNumber: unknown,
  threadId: unknown,
  input: unknown,
): Promise<CommentActionResult<Comment>> {
  if (!isId(workspaceId) || !isNumber(reviewNumber) || !isId(threadId)) {
    return { ok: false, error: NOT_FOUND_ERROR };
  }
  const parsed = validateForm(ReplyRequestSchema, input);
  if (!parsed.success) return invalidBody(parsed.fieldErrors.body);
  return fromApi(await postReply(workspaceId, reviewNumber, threadId, parsed.data.body));
}

export async function editComment(
  workspaceId: unknown,
  reviewNumber: unknown,
  threadId: unknown,
  commentId: unknown,
  input: unknown,
): Promise<CommentActionResult<Comment>> {
  if (!isId(workspaceId) || !isNumber(reviewNumber) || !isId(threadId) || !isId(commentId)) {
    return { ok: false, error: NOT_FOUND_ERROR };
  }
  const parsed = validateForm(EditCommentRequestSchema, input);
  if (!parsed.success) return invalidBody(parsed.fieldErrors.body);
  return fromApi(
    await patchComment(workspaceId, reviewNumber, threadId, commentId, parsed.data.body),
  );
}

export async function deleteComment(
  workspaceId: unknown,
  reviewNumber: unknown,
  threadId: unknown,
  commentId: unknown,
): Promise<CommentActionResult<Comment>> {
  if (!isId(workspaceId) || !isNumber(reviewNumber) || !isId(threadId) || !isId(commentId)) {
    return { ok: false, error: NOT_FOUND_ERROR };
  }
  return fromApi(await deleteCommentRequest(workspaceId, reviewNumber, threadId, commentId));
}

export async function setThreadStatus(
  workspaceId: unknown,
  reviewNumber: unknown,
  threadId: unknown,
  input: unknown,
): Promise<CommentActionResult<Thread>> {
  if (!isId(workspaceId) || !isNumber(reviewNumber) || !isId(threadId)) {
    return { ok: false, error: NOT_FOUND_ERROR };
  }
  const parsed = SetThreadStatusRequestSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: { code: 'invalid', message: 'Unknown status.' } };
  return fromApi(await patchThreadStatus(workspaceId, reviewNumber, threadId, parsed.data.status));
}

export interface LoadedThreads {
  threads: Thread[];
  loadedAt: string;
}

export async function loadThreads(
  workspaceId: unknown,
  reviewNumber: unknown,
): Promise<CommentActionResult<LoadedThreads>> {
  if (!isId(workspaceId) || !isNumber(reviewNumber)) return { ok: false, error: NOT_FOUND_ERROR };
  // Taken before the request, so the threads are at least this new.
  const loadedAt = new Date().toISOString();
  const result = await getThreads(workspaceId, reviewNumber);
  if (!result.ok) {
    return {
      ok: false,
      error: toCommentError({ status: result.status, code: null, fieldErrors: {} }),
    };
  }
  return { ok: true, data: { threads: result.data, loadedAt } };
}
