export function waitText(seconds: number): string {
  if (seconds <= 60) return seconds <= 1 ? '1 second' : `${seconds} seconds`;
  const minutes = Math.ceil(seconds / 60);
  return minutes === 1 ? '1 minute' : `${minutes} minutes`;
}

export function tooManyRequestsMessage(
  retryAfterSeconds: number | undefined,
  what = 'Too many attempts.',
): string {
  return retryAfterSeconds
    ? `${what} Try again in ${waitText(retryAfterSeconds)}.`
    : `${what} Wait a moment and try again.`;
}
