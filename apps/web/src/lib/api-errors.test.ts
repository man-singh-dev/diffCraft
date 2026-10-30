import { describe, expect, it } from 'vitest';
import type { ApiFailure } from './api-client.js';
import { describeApiError } from './api-errors.js';

const failure = (status: number, code: string, message = 'API message'): ApiFailure => ({
  ok: false,
  status,
  code,
  message,
  fieldErrors: {},
});

describe('describeApiError', () => {
  it.each([
    [409, 'last_owner', /at least one owner/],
    [409, 'already_member', /already a member/],
    [404, 'user_not_found', /no diffcraft account/i],
    [403, 'forbidden', /permission/],
    [422, 'validation_error', /highlighted fields/],
  ])('explains %i %s', (status, code, expected) => {
    expect(describeApiError(failure(status, code))).toMatch(expected);
  });

  it('keeps the friendly message of a network error', () => {
    const message = "Couldn't reach the server. Check your connection and try again.";
    expect(describeApiError(failure(0, 'network_error', message))).toBe(message);
  });
});
