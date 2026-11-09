// Same format as the API's tokens: 32 random bytes in unpadded base64url.
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function isVerificationToken(value: unknown): value is string {
  return typeof value === 'string' && TOKEN_PATTERN.test(value);
}

export const DEFAULT_RETRY_AFTER_SECONDS = 60;
const MAX_RETRY_AFTER_SECONDS = 3600;

export function parseRetryAfter(header: string | null): number {
  if (header === null || !/^\d+$/.test(header.trim())) return DEFAULT_RETRY_AFTER_SECONDS;
  const seconds = Number(header.trim());
  if (seconds < 1) return DEFAULT_RETRY_AFTER_SECONDS;
  return Math.min(seconds, MAX_RETRY_AFTER_SECONDS);
}
