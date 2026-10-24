import type { z } from 'zod';

/**
 * An error that is safe to show to the client. The global error handler turns it into
 * `{ error: { code, message, details } }` with `statusCode`. Anything else becomes a 500.
 */
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

/** 422 for a request body that fails its Zod schema. */
export class ValidationError extends AppError {
  constructor(issues: readonly z.core.$ZodIssue[]) {
    // Only path and message are copied: Zod issues can carry the input, which may be a password.
    const details: FieldIssue[] = issues.map((issue) => ({
      field: issue.path.join('.'),
      message: issue.message,
    }));
    super(422, 'validation_error', 'The request body is invalid.', details);
  }
}
