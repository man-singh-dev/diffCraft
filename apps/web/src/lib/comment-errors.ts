import type { FieldErrors } from './form-errors';
import { tooManyRequestsMessage } from './rate-limit';

export type CommentErrorCode =
  'unauthorized' | 'forbidden' | 'not_found' | 'invalid' | 'rate_limited' | 'failed';

export interface CommentActionError {
  code: CommentErrorCode;
  message: string;
  bodyError?: string;
}

export type CommentActionResult<T> =
  { ok: true; data: T } | { ok: false; error: CommentActionError };

const NOT_FOUND_MESSAGES: Partial<Record<string, string>> = {
  thread_not_found: 'This thread no longer exists. Refresh the page.',
  comment_not_found: 'This comment was deleted or no longer exists. Refresh the page.',
  review_file_not_found: 'This file is no longer part of the review.',
  review_not_found: "This review doesn't exist any more.",
  workspace_not_found: "This workspace doesn't exist any more, or you are no longer a member.",
};

export const SESSION_ENDED = 'Your session has ended. Log in again.';
export const NOT_FOUND_ERROR: CommentActionError = {
  code: 'not_found',
  message: "This review doesn't exist any more.",
};

export function toCommentError(failure: {
  status: number;
  code: string | null;
  fieldErrors: FieldErrors;
  retryAfterSeconds?: number;
}): CommentActionError {
  const { status, code, fieldErrors } = failure;
  if (status === 401) return { code: 'unauthorized', message: SESSION_ENDED };
  if (status === 429) {
    return {
      code: 'rate_limited',
      message: tooManyRequestsMessage(failure.retryAfterSeconds, "You're commenting too quickly."),
    };
  }
  if (status === 403) {
    return {
      code: 'forbidden',
      message:
        "You don't have permission to do that. Your role may have changed; refresh the page.",
    };
  }
  if (status === 404) {
    return {
      code: 'not_found',
      message: (code && NOT_FOUND_MESSAGES[code]) ?? NOT_FOUND_ERROR.message,
    };
  }
  if (status === 422) {
    if (code === 'invalid_anchor') {
      return { code: 'invalid', message: "You can't comment on that line." };
    }
    const bodyError = fieldErrors.body;
    return {
      code: 'invalid',
      message: bodyError ?? 'Check your comment and try again.',
      ...(bodyError && { bodyError }),
    };
  }
  return { code: 'failed', message: "Couldn't save that. Please try again." };
}
