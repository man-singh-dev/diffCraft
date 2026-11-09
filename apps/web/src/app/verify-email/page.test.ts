import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({ cookies: () => Promise.resolve({ get: () => undefined }) }));

const { metadata } = await import('./page.js');
const { default: nextConfig } = await import('../../../next.config.js');

describe('/verify-email referrer policy', () => {
  it('sets no-referrer in the page metadata', () => {
    expect(metadata.referrer).toBe('no-referrer');
  });

  it('sends a Referrer-Policy: no-referrer header for the route', async () => {
    const rules = (await nextConfig.headers?.()) ?? [];
    const rule = rules.find((r) => r.source === '/verify-email');
    expect(rule?.headers).toContainEqual({ key: 'Referrer-Policy', value: 'no-referrer' });
  });
});
