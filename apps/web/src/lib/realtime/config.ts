export type RealtimeConfig =
  { ok: true; url: string } | { ok: false; reason: 'missing' | 'invalid' };

export function parseRealtimeUrl(raw: string | undefined): RealtimeConfig {
  const value = raw?.trim();
  if (!value) return { ok: false, reason: 'missing' };
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, reason: 'invalid' };
  }
  // Socket.IO reads a URL path as a namespace, so only a bare origin is accepted.
  const bareOrigin =
    url.pathname === '/' && !url.search && !url.hash && !url.username && !url.password;
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !bareOrigin) {
    return { ok: false, reason: 'invalid' };
  }
  return { ok: true, url: url.origin };
}

// Written out in full: Next.js inlines NEXT_PUBLIC_* only for this literal expression.
export const realtimeConfig = parseRealtimeUrl(process.env.NEXT_PUBLIC_REALTIME_URL);

export const realtimeEnabled = realtimeConfig.ok;

let warned = false;

export function warnIfRealtimeDisabled(
  config: RealtimeConfig = realtimeConfig,
  isDev = process.env.NODE_ENV === 'development',
) {
  if (config.ok || warned) return;
  warned = true;
  if (config.reason === 'invalid') {
    console.error(
      'NEXT_PUBLIC_REALTIME_URL must be an http(s) origin such as http://localhost:4000; live updates are off.',
    );
  } else if (isDev) {
    console.warn('NEXT_PUBLIC_REALTIME_URL is not set; live updates are off.');
  }
}
