import type { z } from 'zod';

/**
 * Formats Zod issues as one "  - path: message" line each, for startup error messages.
 * Only paths and messages are included, never the input values (they may be secrets).
 */
export function formatZodIssues(issues: readonly z.core.$ZodIssue[]): string {
  return issues
    .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('\n');
}
