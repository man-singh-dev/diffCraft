import type { DiffParseErrorCode } from '@diffcraft/shared';
import { describe, expect, it } from 'vitest';
import type { ApiFailure } from './api-client.js';
import { describePatchError, describeReviewError } from './review-errors.js';

const failure = (status: number, code: string, details?: unknown): ApiFailure => ({
  ok: false,
  status,
  code,
  message: `server message for ${code}`,
  fieldErrors: {},
  ...(details !== undefined && { details }),
});

const REASONS: DiffParseErrorCode[] = [
  'empty_patch',
  'too_large',
  'too_many_files',
  'too_many_lines',
  'line_too_long',
  'not_a_patch',
  'malformed_header',
  'malformed_hunk',
  'count_mismatch',
  'unsupported_encoding',
];

describe('describePatchError', () => {
  it.each(REASONS)('has its own message for %s', (reason) => {
    expect(describePatchError(reason, null)).not.toBe("The patch couldn't be read.");
  });

  it('gives every reason a different message', () => {
    expect(new Set(REASONS.map((r) => describePatchError(r, null))).size).toBe(REASONS.length);
  });

  it('adds the line when there is one', () => {
    expect(describePatchError('malformed_hunk', 12)).toBe(
      'Line 12: A hunk (@@ … @@ section) is malformed.',
    );
    expect(describePatchError('empty_patch', null)).toBe('The patch is empty.');
  });

  it('tells the user to save as UTF-8 for unsupported_encoding', () => {
    expect(describePatchError('unsupported_encoding', 1)).toContain('Save the file as UTF-8');
  });

  it('falls back for an unknown reason', () => {
    expect(describePatchError('something_new', 3)).toBe("Line 3: The patch couldn't be read.");
  });
});

describe('describeReviewError', () => {
  it('describes invalid_patch from its reason and line', () => {
    const result = describeReviewError(
      failure(400, 'invalid_patch', { reason: 'count_mismatch', line: 7 }),
    );
    expect(result).toBe("Line 7: A hunk's lines don't match the counts in its @@ header.");
  });

  it('uses the server message for invalid_patch without usable details', () => {
    expect(describeReviewError(failure(400, 'invalid_patch'))).toBe(
      'server message for invalid_patch',
    );
    expect(describeReviewError(failure(400, 'invalid_patch', { line: 'x' }))).toBe(
      'server message for invalid_patch',
    );
  });

  it.each([
    ['payload_too_large', 413, '1 MiB'],
    ['review_not_found', 404, 'deleted'],
    ['forbidden', 403, 'Only the author or an admin'],
  ])('has a friendly message for %s', (code, status, text) => {
    expect(describeReviewError(failure(status, code))).toContain(text);
  });

  it('falls back to the general messages', () => {
    expect(describeReviewError(failure(404, 'workspace_not_found'))).toContain(
      'no longer a member',
    );
    expect(describeReviewError(failure(422, 'validation_error'))).toBe(
      'Check the highlighted fields.',
    );
    expect(describeReviewError(failure(0, 'network_error'))).toBe(
      'server message for network_error',
    );
  });
});
