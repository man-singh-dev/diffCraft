import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';

// No query is made, and the pool connects lazily, so no database is needed.
const DATABASE_URL = 'postgresql://user:pass@localhost:5432/db';
const PROXY = '10.0.0.1'; // a private address, like the host's proxy
const CLIENT = '203.0.113.7';

describe('trustProxy', () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  /** Builds the app with an extra route that echoes request.ip. */
  const appWith = async (env: Record<string, string>) => {
    app = await buildApp(loadConfig({ LOG_LEVEL: 'silent', DATABASE_URL, ...env }));
    app.get('/test-ip', async (request) => ({ ip: request.ip }));
    return app;
  };

  const ipFor = async (instance: FastifyInstance, peer: string, forwardedFor: string) => {
    const res = await instance.inject({
      url: '/test-ip',
      remoteAddress: peer,
      headers: { 'x-forwarded-for': forwardedFor },
    });
    return (res.json() as { ip: string }).ip;
  };

  it('ignores X-Forwarded-For outside production', async () => {
    const instance = await appWith({ NODE_ENV: 'development' });
    expect(await ipFor(instance, PROXY, CLIENT)).toBe(PROXY);
  });

  describe('in production', () => {
    it('uses the client address the proxy added', async () => {
      const instance = await appWith({ NODE_ENV: 'production' });
      expect(await ipFor(instance, PROXY, CLIENT)).toBe(CLIENT);
    });

    it('ignores addresses a client put in front (spoofing)', async () => {
      const instance = await appWith({ NODE_ENV: 'production' });
      expect(await ipFor(instance, PROXY, `6.6.6.6, ${CLIENT}`)).toBe(CLIENT);
    });

    it('skips several private proxy hops', async () => {
      const instance = await appWith({ NODE_ENV: 'production' });
      expect(await ipFor(instance, PROXY, `6.6.6.6, ${CLIENT}, 10.0.0.2`)).toBe(CLIENT);
    });

    it('ignores the header from a peer that is not a trusted proxy', async () => {
      const instance = await appWith({ NODE_ENV: 'production' });
      expect(await ipFor(instance, '198.51.100.9', CLIENT)).toBe('198.51.100.9');
    });

    it('trusts only the proxies listed in TRUST_PROXY', async () => {
      const instance = await appWith({ NODE_ENV: 'production', TRUST_PROXY: '10.0.0.0/24' });
      expect(await ipFor(instance, PROXY, CLIENT)).toBe(CLIENT);
      expect(await ipFor(instance, '10.0.1.1', CLIENT)).toBe('10.0.1.1');
    });
  });
});
