import type { ServerSendFailure } from './api.server';

export type AiErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'disabled'
  | 'rate_limited'
  | 'invalid'
  | 'failed';

export interface AiActionError {
  code: AiErrorCode;
  message: string;
  retryAfterSeconds?: number;
}

export type AiActionResult<T> = { ok: true; data: T } | { ok: false; error: AiActionError };

export const NOT_FOUND_ERROR: AiActionError = {
  code: 'not_found',
  message: "This review doesn't exist any more.",
};

export const NETWORK_ERROR: AiActionError = {
  code: 'failed',
  message: "Couldn't reach the server. Check your connection and try again.",
};

const MESSAGES: Partial<Record<string, AiActionError>> = {
  unauthenticated: { code: 'unauthorized', message: 'Your session has ended. Log in again.' },
  ai_disabled: { code: 'disabled', message: 'AI review is turned off on this server.' },
  review_not_open: {
    code: 'conflict',
    message: 'This review is closed or merged. Only open reviews can be analyzed.',
  },
  finding_not_found: {
    code: 'not_found',
    message: 'This finding no longer exists. Refresh the page.',
  },
  review_not_found: NOT_FOUND_ERROR,
  workspace_not_found: {
    code: 'not_found',
    message: "This workspace doesn't exist any more, or you are no longer a member.",
  },
};

function retryAfterFrom(failure: ServerSendFailure): number | undefined {
  if (failure.retryAfterSeconds !== undefined) return failure.retryAfterSeconds;
  const details = failure.details;
  if (details && typeof details === 'object' && 'retryAfterSeconds' in details) {
    const value = details.retryAfterSeconds;
    if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value;
  }
  return undefined;
}

export function toAiError(failure: ServerSendFailure): AiActionError {
  const { status, code } = failure;
  if (status === 401) return MESSAGES.unauthenticated!;
  if (status === 429 || code === 'analysis_limit_reached') {
    const retryAfterSeconds = retryAfterFrom(failure);
    return {
      code: 'rate_limited',
      message: 'This workspace has used all of its AI reviews for the last 24 hours.',
      ...(retryAfterSeconds !== undefined && { retryAfterSeconds }),
    };
  }
  const known = code ? MESSAGES[code] : undefined;
  if (known) return known;
  if (status === 403) {
    return {
      code: 'forbidden',
      message:
        "You don't have permission to do that. Your role may have changed; refresh the page.",
    };
  }
  if (status === 404) return NOT_FOUND_ERROR;
  if (status === 409) return MESSAGES.review_not_open!;
  if (status === 503) return MESSAGES.ai_disabled!;
  if (status === 422) return { code: 'invalid', message: 'Check your input and try again.' };
  return { code: 'failed', message: "Couldn't do that. Please try again." };
}

/** A thrown error (network, or an action id from an older deploy) is a failure. */
export async function runAiAction<T>(
  action: () => Promise<AiActionResult<T>>,
): Promise<AiActionResult<T>> {
  try {
    return await action();
  } catch {
    return { ok: false, error: NETWORK_ERROR };
  }
}
