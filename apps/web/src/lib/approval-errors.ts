import {
  InvalidReviewersDetailsSchema,
  MergeBlockedDetailsSchema,
  type InvalidReviewersDetails,
} from '@diffcraft/shared';
import type { ServerSendFailure } from './api.server';

export type ApprovalErrorCode =
  'unauthorized' | 'forbidden' | 'not_found' | 'conflict' | 'invalid' | 'failed';

export interface ReviewerError {
  userId: string;
  message: string;
}

export interface ApprovalActionError {
  code: ApprovalErrorCode;
  message: string;
  reasons?: string[];
  reviewerErrors?: ReviewerError[];
  fieldErrors?: Partial<Record<string, string>>;
}

export type ApprovalActionResult<T> =
  { ok: true; data: T } | { ok: false; error: ApprovalActionError };

export const NOT_FOUND_ERROR: ApprovalActionError = {
  code: 'not_found',
  message: "This review doesn't exist any more.",
};

export const NETWORK_ERROR: ApprovalActionError = {
  code: 'failed',
  message: "Couldn't reach the server. Check your connection and try again.",
};

const REVIEWER_REASONS: Record<InvalidReviewersDetails[number]['reason'], string> = {
  not_a_member: 'is not a member of this workspace any more',
  viewer: 'is a viewer, and viewers cannot review',
  author: 'wrote this review, so they cannot review it',
};

const MESSAGES: Partial<Record<string, ApprovalActionError>> = {
  unauthenticated: { code: 'unauthorized', message: 'Your session has ended. Log in again.' },
  forbidden: {
    code: 'forbidden',
    message: "You don't have permission to do that. Your role may have changed; refresh the page.",
  },
  not_a_reviewer: {
    code: 'forbidden',
    message: "You're not a reviewer of this review any more. Refresh the page.",
  },
  review_not_open: {
    code: 'conflict',
    message: 'This review is closed or merged, so it no longer takes approvals.',
  },
  review_merged: { code: 'conflict', message: 'This review has already been merged.' },
  reviewer_not_found: {
    code: 'not_found',
    message: 'That person is no longer a reviewer. Refresh the page.',
  },
  review_not_found: NOT_FOUND_ERROR,
  workspace_not_found: {
    code: 'not_found',
    message: "This workspace doesn't exist any more, or you are no longer a member.",
  },
};

export function toApprovalError(failure: ServerSendFailure): ApprovalActionError {
  const { status, code, details, fieldErrors } = failure;
  if (status === 401) return MESSAGES.unauthenticated!;

  if (code === 'merge_blocked') {
    const parsed = MergeBlockedDetailsSchema.safeParse(details);
    return {
      code: 'conflict',
      message: "This review can't be merged yet.",
      reasons: parsed.success ? parsed.data.reasons : [],
    };
  }
  if (code === 'invalid_reviewers') {
    const parsed = InvalidReviewersDetailsSchema.safeParse(details);
    return {
      code: 'invalid',
      message: "Some of these people can't review this change.",
      reviewerErrors: parsed.success
        ? parsed.data.map(({ userId, reason }) => ({ userId, message: REVIEWER_REASONS[reason] }))
        : [],
    };
  }
  const known = code ? MESSAGES[code] : undefined;
  if (known) return known;

  if (status === 403) return MESSAGES.forbidden!;
  if (status === 404) return NOT_FOUND_ERROR;
  if (status === 409) {
    return { code: 'conflict', message: 'This review changed in the meantime. Refresh the page.' };
  }
  if (status === 422) {
    return { code: 'invalid', message: 'Check your input and try again.', fieldErrors };
  }
  return { code: 'failed', message: "Couldn't save that. Please try again." };
}

/** A thrown error (network, or an action id from an older deploy) is a failure. */
export async function run<T>(
  action: () => Promise<ApprovalActionResult<T>>,
): Promise<ApprovalActionResult<T>> {
  try {
    return await action();
  } catch {
    return { ok: false, error: NETWORK_ERROR };
  }
}
