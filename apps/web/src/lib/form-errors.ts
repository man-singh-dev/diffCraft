import type { z } from 'zod';

export type FieldErrors = Partial<Record<string, string>>;

export function toFieldErrors(issues: readonly { field: string; message: string }[]): FieldErrors {
  const errors: FieldErrors = {};
  for (const { field, message } of issues) errors[field] ??= message;
  return errors;
}

// Friendlier wording than Zod's defaults without changing the shared schemas (and so the API's 422s). Undefined keeps Zod's.
function friendlyMessage(issue: z.core.$ZodRawIssue): string | undefined {
  switch (issue.code) {
    case 'too_small':
      return issue.minimum === 1
        ? 'This field is required.'
        : `Must be at least ${issue.minimum} characters.`;
    case 'too_big':
      return `Must be at most ${issue.maximum} characters.`;
    case 'invalid_format':
      return issue.format === 'email' ? 'Enter a valid email address.' : undefined;
    default:
      return undefined;
  }
}

export function validateForm<T extends z.ZodType>(
  schema: T,
  input: unknown,
): { success: true; data: z.output<T> } | { success: false; fieldErrors: FieldErrors } {
  const result = schema.safeParse(input, { error: friendlyMessage });
  if (result.success) return { success: true, data: result.data };

  const issues = result.error.issues.map((issue) => ({
    field: issue.path.join('.'),
    message: issue.message,
  }));
  return { success: false, fieldErrors: toFieldErrors(issues) };
}
