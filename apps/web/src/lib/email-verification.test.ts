import { describe, expect, it } from 'vitest';
import { isVerificationToken, parseRetryAfter } from './email-verification.js';

describe('isVerificationToken', () => {
  it('accepts 43 base64url characters', () => {
    expect(isVerificationToken('Ab0_-'.repeat(8) + 'xyz')).toBe(true);
  });

  it.each([
    ['missing', undefined],
    ['repeated param', ['a'.repeat(43), 'b'.repeat(43)]],
    ['empty', ''],
    ['42 chars', 'a'.repeat(42)],
    ['44 chars', 'a'.repeat(44)],
    ['padding', 'a'.repeat(42) + '='],
    ['standard base64', 'a'.repeat(42) + '+'],
    ['whitespace', ' ' + 'a'.repeat(42)],
  ])('rejects %s', (_, value) => {
    expect(isVerificationToken(value)).toBe(false);
  });
});

describe('parseRetryAfter', () => {
  it('reads delta seconds', () => {
    expect(parseRetryAfter('42')).toBe(42);
  });

  it.each([null, '', 'abc', '-5', '0', '1.5', 'Wed, 21 Oct 2026 07:28:00 GMT'])(
    'falls back to 60 for %j',
    (header) => {
      expect(parseRetryAfter(header)).toBe(60);
    },
  );

  it('caps absurd values at an hour', () => {
    expect(parseRetryAfter('999999')).toBe(3600);
  });
});
