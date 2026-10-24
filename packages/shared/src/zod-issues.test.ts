import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { formatZodIssues } from './zod-issues.js';

describe('formatZodIssues', () => {
  it('lists each issue with its path, one per line', () => {
    const result = z
      .object({ a: z.string(), nested: z.object({ b: z.number() }) })
      .safeParse({ nested: {} });
    if (result.success) throw new Error('expected a parse failure');

    const lines = formatZodIssues(result.error.issues).split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^ {2}- a: /);
    expect(lines[1]).toMatch(/^ {2}- nested\.b: /);
  });

  it('uses "(root)" for an issue without a path', () => {
    const result = z.string().safeParse(1);
    if (result.success) throw new Error('expected a parse failure');

    expect(formatZodIssues(result.error.issues)).toMatch(/^ {2}- \(root\): /);
  });

  it('does not include the input value', () => {
    const result = z.object({ url: z.url() }).safeParse({ url: 'secret-value' });
    if (result.success) throw new Error('expected a parse failure');

    expect(formatZodIssues(result.error.issues)).not.toContain('secret-value');
  });
});
