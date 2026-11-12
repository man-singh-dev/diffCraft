export interface CspOptions {
  nonce: string;
  dev: boolean;
  https: boolean;
  realtimeOrigin: string | null;
}

export function createNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}

// Socket.IO starts with HTTP long-polling and then upgrades to a WebSocket on the same host.
export function realtimeSources(origin: string): string[] {
  const url = new URL(origin);
  return [url.origin, `${url.protocol === 'https:' ? 'wss:' : 'ws:'}//${url.host}`];
}

export function contentSecurityPolicy({ nonce, dev, https, realtimeOrigin }: CspOptions): string {
  const directives: [string, ...string[]][] = [
    ['default-src', "'self'"],
    // React uses eval only in development, to rebuild server error stacks.
    [
      'script-src',
      "'self'",
      `'nonce-${nonce}'`,
      "'strict-dynamic'",
      ...(dev ? ["'unsafe-eval'"] : []),
    ],
    // Shiki colours tokens and React sets positions with style attributes, which a nonce can't cover.
    ['style-src', "'self'", "'unsafe-inline'"],
    ['img-src', "'self'", 'data:'],
    ['font-src', "'self'"],
    ['connect-src', "'self'", ...(realtimeOrigin ? realtimeSources(realtimeOrigin) : [])],
    ['object-src', "'none'"],
    ['base-uri', "'self'"],
    ['form-action', "'self'"],
    ['frame-ancestors', "'none'"],
  ];
  if (!dev && https) directives.push(['upgrade-insecure-requests']);
  return directives.map((parts) => parts.join(' ')).join('; ');
}
