import { AppError } from '../../errors.js';

/** 422 for an anchor that doesn't point at a line in the file's diff. */
export class CommentAnchorInvalidError extends AppError {
  constructor(message = 'That line is not in the diff.') {
    super(422, 'invalid_anchor', message);
  }
}
