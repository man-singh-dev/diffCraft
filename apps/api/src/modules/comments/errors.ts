import { AppError, NotFoundError } from '../../errors.js';

export class CommentAnchorInvalidError extends AppError {
  constructor(message = 'That line is not in the diff.') {
    super(422, 'invalid_anchor', message);
  }
}

export class ThreadNotFoundError extends NotFoundError {
  constructor() {
    super('thread_not_found', 'Thread not found in this review.');
  }
}

export class CommentNotFoundError extends NotFoundError {
  constructor() {
    super('comment_not_found', 'Comment not found in this thread.');
  }
}

export class SuggestionNotApplicableError extends AppError {
  constructor() {
    super(
      422,
      'suggestion_not_applicable',
      'Suggestions only apply to lines on the new side of a file.',
    );
  }
}

export class SuggestionNotFoundError extends NotFoundError {
  constructor() {
    super('suggestion_not_found', 'This comment has no suggested change.');
  }
}
