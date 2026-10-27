import { describe, expect, it } from 'vitest';
import { hashSessionToken, SESSION_TTL_SECONDS, sessionCookieOptions } from './session.js';

describe('hashSessionToken', () => {
  it('returns a SHA-256 hex digest, not the token', () => {
    const token = 'a'.repeat(43);
    const hash = hashSessionToken(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(token);
    expect(hashSessionToken(token)).toBe(hash);
  });
});

describe('sessionCookieOptions', () => {
  it('is HttpOnly, SameSite=Lax, Path=/ and lives as long as the session', () => {
    expect(sessionCookieOptions(false)).toEqual({
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: SESSION_TTL_SECONDS,
      secure: false,
    });
  });

  it('adds Secure when asked (production)', () => {
    expect(sessionCookieOptions(true).secure).toBe(true);
  });

  it('uses a 7-day lifetime', () => {
    expect(SESSION_TTL_SECONDS).toBe(604_800);
  });
});
