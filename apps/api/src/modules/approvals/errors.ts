import { AppError } from '../../errors.js';

export type InvalidReviewerReason = 'not_a_member' | 'viewer' | 'author';

export class InvalidReviewersError extends AppError {
  constructor(invalid: { userId: string; reason: InvalidReviewerReason }[]) {
    super(
      422,
      'invalid_reviewers',
      'Reviewers must be members of the workspace who can comment, and not the review author.',
      invalid,
    );
  }
}

export class NotAReviewerError extends AppError {
  constructor() {
    super(403, 'not_a_reviewer', 'Only assigned reviewers can approve or request changes.');
  }
}

export class ReviewNotOpenError extends AppError {
  constructor() {
    super(409, 'review_not_open', 'Decisions can only be submitted on an open review.');
  }
}

export class MergeBlockedError extends AppError {
  constructor(readonly reasons: string[]) {
    super(409, 'merge_blocked', `This review can't be merged: ${reasons.join('; ')}.`, {
      reasons,
    });
  }
}
