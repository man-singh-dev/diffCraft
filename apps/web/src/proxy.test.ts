import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CLIENT_IP_HEADER, PROXY_SECRET_HEADER } from './lib/client-ip';
import { config, proxy } from './proxy';

const SECRET = 'test-web-proxy-secret'.padEnd(32, '-');

afterEach(() => {
  vi.unstubAllEnvs();
});

const request = (url: string, headers: Record<string, string> = {}) =>
  new NextRequest(url, { headers });

const directives = (csp: string) =>
  new Map(
    csp.split('; ').map((directive) => {
      const [name, ...values] = directive.split(' ');
      return [name!, values];
    }),
  );

// NextResponse.next({ request: { headers } }) passes request headers on as x-middleware-request-*.
const forwarded = (response: Response, name: string) =>
  response.headers.get(`x-middleware-request-${name}`);

describe('proxy: pages', () => {
  it('sets a CSP with a fresh nonce on every request, and gives the nonce to Next.js', () => {
    const first = proxy(request('http://localhost:3000/workspaces'));
    const second = proxy(request('http://localhost:3000/workspaces'));
    const csp = first.headers.get('content-security-policy')!;
    const nonce = forwarded(first, 'x-nonce')!;
    expect(nonce).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    expect(forwarded(second, 'x-nonce')).not.toBe(nonce);
    expect(forwarded(first, 'content-security-policy')).toBe(csp);

    const policy = directives(csp);
    expect(policy.get('script-src')).toEqual(["'self'", `'nonce-${nonce}'`, "'strict-dynamic'"]);
    expect(policy.get('default-src')).toEqual(["'self'"]);
    expect(policy.get('style-src')).toEqual(["'self'", "'unsafe-inline'"]);
    expect(policy.get('img-src')).toEqual(["'self'", 'data:']);
    expect(policy.get('object-src')).toEqual(["'none'"]);
    expect(policy.get('frame-ancestors')).toEqual(["'none'"]);
    expect(policy.get('base-uri')).toEqual(["'self'"]);
    expect(policy.get('form-action')).toEqual(["'self'"]);
  });

  it('allows the realtime origin over HTTP and WebSocket in connect-src', () => {
    vi.stubEnv('NEXT_PUBLIC_REALTIME_URL', 'https://api.example.com');
    const csp = proxy(request('https://app.example.com/')).headers.get('content-security-policy')!;
    expect(directives(csp).get('connect-src')).toEqual([
      "'self'",
      'https://api.example.com',
      'wss://api.example.com',
    ]);
  });

  it('allows unsafe-eval only in development, and upgrades requests only in production over HTTPS', () => {
    vi.stubEnv('NODE_ENV', 'development');
    const dev = directives(
      proxy(request('https://app.example.com/')).headers.get('content-security-policy')!,
    );
    expect(dev.get('script-src')).toContain("'unsafe-eval'");
    expect(dev.has('upgrade-insecure-requests')).toBe(false);

    vi.stubEnv('NODE_ENV', 'production');
    const prod = directives(
      proxy(request('https://app.example.com/')).headers.get('content-security-policy')!,
    );
    expect(prod.get('script-src')).not.toContain("'unsafe-eval'");
    expect(prod.has('upgrade-insecure-requests')).toBe(true);
    const localProd = directives(
      proxy(request('http://localhost:3000/')).headers.get('content-security-policy')!,
    );
    expect(localProd.has('upgrade-insecure-requests')).toBe(false);
  });
});

describe('proxy: /api requests', () => {
  it('forwards the client IP with the secret, and drops values the client sent', () => {
    vi.stubEnv('WEB_PROXY_SECRET', SECRET);
    const response = proxy(
      request('https://app.example.com/api/v1/auth/login', {
        'x-forwarded-for': '203.0.113.5, 10.0.0.1',
        [CLIENT_IP_HEADER]: '6.6.6.6',
        [PROXY_SECRET_HEADER]: 'guess',
      }),
    );
    expect(forwarded(response, CLIENT_IP_HEADER)).toBe('203.0.113.5');
    expect(forwarded(response, PROXY_SECRET_HEADER)).toBe(SECRET);
    expect(response.headers.get('content-security-policy')).toBeNull();
  });

  it('forwards nothing without a secret', () => {
    const response = proxy(
      request('https://app.example.com/api/v1/auth/login', {
        'x-forwarded-for': '203.0.113.5',
        [CLIENT_IP_HEADER]: '6.6.6.6',
      }),
    );
    expect(forwarded(response, CLIENT_IP_HEADER)).toBeNull();
    expect(forwarded(response, PROXY_SECRET_HEADER)).toBeNull();
  });
});

it('runs on pages and /api, not on static assets', () => {
  const [pattern] = config.matcher;
  const matches = (path: string) => new RegExp(`^${pattern}$`).test(path);
  expect(matches('/workspaces/1')).toBe(true);
  expect(matches('/api/v1/auth/login')).toBe(true);
  expect(matches('/_next/static/chunks/main.js')).toBe(false);
  expect(matches('/favicon.ico')).toBe(false);
});
