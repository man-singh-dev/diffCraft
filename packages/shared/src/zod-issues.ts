import type { z } from 'zod';

// Only paths and messages, never input values: they may be secrets.
export function formatZodIssues(issues: readonly z.core.$ZodIssue[]): string {
  return issues
    .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('\n');
}
