import { describe, expect, it } from 'vitest';
import {
  CLIENT_IP_HEADER,
  clientIpFrom,
  forwardingHeaders,
  PROXY_SECRET_HEADER,
  proxySecretFrom,
} from './client-ip';

describe('clientIpFrom', () => {
  it('takes the first X-Forwarded-For entry if it is an IP address', () => {
    expect(clientIpFrom(new Headers({ 'x-forwarded-for': '203.0.113.5, 10.0.0.1' }))).toBe(
      '203.0.113.5',
    );
    expect(clientIpFrom(new Headers({ 'x-forwarded-for': '2001:db8::1' }))).toBe('2001:db8::1');
    expect(clientIpFrom(new Headers({ 'x-forwarded-for': 'evil, 203.0.113.5' }))).toBeNull();
    expect(clientIpFrom(new Headers())).toBeNull();
  });
});

describe('forwardingHeaders', () => {
  const secret = 'test-web-proxy-secret'.padEnd(32, '-');

  it('sends the IP and the secret together, or nothing', () => {
    expect(forwardingHeaders('203.0.113.5', secret)).toEqual({
      [CLIENT_IP_HEADER]: '203.0.113.5',
      [PROXY_SECRET_HEADER]: secret,
    });
    expect(forwardingHeaders(null, secret)).toEqual({});
    expect(forwardingHeaders('203.0.113.5', undefined)).toEqual({});
  });

  it('ignores a secret shorter than 32 characters', () => {
    expect(proxySecretFrom('short')).toBeUndefined();
    expect(proxySecretFrom(secret)).toBe(secret);
  });
});
