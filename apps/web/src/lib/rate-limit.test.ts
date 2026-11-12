import { describe, expect, it } from 'vitest';
import { describeApiError } from './api-errors';
import { toAiError } from './ai-errors';
import { toCommentError } from './comment-errors';
import { tooManyRequestsMessage, waitText } from './rate-limit';

describe('tooManyRequestsMessage', () => {
  it('says how long to wait', () => {
    expect(waitText(1)).toBe('1 second');
    expect(waitText(42)).toBe('42 seconds');
    expect(waitText(61)).toBe('2 minutes');
    expect(waitText(900)).toBe('15 minutes');
    expect(tooManyRequestsMessage(90)).toBe('Too many attempts. Try again in 2 minutes.');
    expect(tooManyRequestsMessage(undefined)).toBe(
      'Too many attempts. Wait a moment and try again.',
    );
  });
});

describe('429 messages', () => {
  it('login and register', () => {
    expect(
      describeApiError({
        ok: false,
        status: 429,
        code: 'rate_limited',
        message: 'Too many requests. Try again in 900 seconds.',
        fieldErrors: {},
        retryAfterSeconds: 840,
      }),
    ).toBe('Too many attempts. Try again in 14 minutes.');
  });

  it('comments', () => {
    expect(
      toCommentError({ status: 429, code: 'rate_limited', fieldErrors: {}, retryAfterSeconds: 20 }),
    ).toEqual({
      code: 'rate_limited',
      message: "You're commenting too quickly. Try again in 20 seconds.",
    });
  });

  it('AI: the burst limit and the daily limit read differently', () => {
    const burst = toAiError({
      ok: false,
      status: 429,
      code: 'rate_limited',
      fieldErrors: {},
      retryAfterSeconds: 30,
    });
    expect(burst).toEqual({
      code: 'rate_limited',
      message: "You're starting AI reviews too quickly.",
      retryAfterSeconds: 30,
    });
    const daily = toAiError({
      ok: false,
      status: 429,
      code: 'analysis_limit_reached',
      fieldErrors: {},
      retryAfterSeconds: 3600,
    });
    expect(daily.message).toMatch(/last 24 hours/);
  });
});
