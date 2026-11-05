import type { DiffParseError } from '@diffcraft/shared';
import { AppError, NotFoundError } from '../../errors.js';

export class ReviewNotFoundError extends NotFoundError {
  constructor() {
    super('review_not_found', 'Review not found.');
  }
}

export class ReviewFileNotFoundError extends NotFoundError {
  constructor() {
    super('review_file_not_found', 'File not found in this review.');
  }
}

export class InvalidCursorError extends AppError {
  constructor() {
    super(400, 'invalid_cursor', 'The cursor is invalid. Start again without one.');
  }
}

export class InvalidPatchError extends AppError {
  constructor(error: DiffParseError) {
    super(400, 'invalid_patch', error.message, { reason: error.code, line: error.line });
  }
}
