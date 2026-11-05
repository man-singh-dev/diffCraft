import type { z } from 'zod';

export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export interface FieldIssue {
  field: string;
  message: string;
}

export class NotFoundError extends AppError {
  constructor(code = 'not_found', message = 'Not found.') {
    super(404, code, message);
  }
}

export class ForbiddenError extends AppError {
  constructor() {
    super(403, 'forbidden', 'You do not have permission to do this.');
  }
}

export class ValidationError extends AppError {
  constructor(issues: readonly z.core.$ZodIssue[], message = 'The request body is invalid.') {
    // Only path and message are copied: Zod issues can carry the input, which may be a password.
    const details: FieldIssue[] = issues.map((issue) => ({
      field: issue.path.join('.'),
      message: issue.message,
    }));
    super(422, 'validation_error', message, details);
  }
}
