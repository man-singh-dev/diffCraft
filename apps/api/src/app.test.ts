import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { CLIENT_IP_HEADER, PROXY_SECRET_HEADER } from './plugins/client-ip.js';

// The pool connects lazily and no query is made, so no database is needed.
const DATABASE_URL = 'postgresql://user:pass@localhost:5432/db';
const PROXY = '10.0.0.1';
const CLIENT = '203.0.113.7';
const WEB_PROXY_SECRET = 'test-web-proxy-secret'.padEnd(32, '-');

describe('trustProxy', () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  const appWith = async (env: Record<string, string>) => {
    app = await buildApp(
      loadConfig({
        LOG_LEVEL: 'silent',
        RATE_LIMIT_ENABLED: 'false',
        DATABASE_URL,
        MAIL_TRANSPORT: 'log',
        AI_PROVIDER: 'disabled',
        ...env,
      }),
    );
    app.get('/test-ip', async (request) => ({ ip: request.ip, clientIp: request.clientIp }));
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
      const instance = await appWith({
        NODE_ENV: 'production',
        REDIS_URL: 'redis://localhost:6379',
      });
      expect(await ipFor(instance, PROXY, CLIENT)).toBe(CLIENT);
    });

    it('ignores addresses a client put in front (spoofing)', async () => {
      const instance = await appWith({
        NODE_ENV: 'production',
        REDIS_URL: 'redis://localhost:6379',
      });
      expect(await ipFor(instance, PROXY, `6.6.6.6, ${CLIENT}`)).toBe(CLIENT);
    });

    it('skips several private proxy hops', async () => {
      const instance = await appWith({
        NODE_ENV: 'production',
        REDIS_URL: 'redis://localhost:6379',
      });
      expect(await ipFor(instance, PROXY, `6.6.6.6, ${CLIENT}, 10.0.0.2`)).toBe(CLIENT);
    });

    it('ignores the header from a peer that is not a trusted proxy', async () => {
      const instance = await appWith({
        NODE_ENV: 'production',
        REDIS_URL: 'redis://localhost:6379',
      });
      expect(await ipFor(instance, '198.51.100.9', CLIENT)).toBe('198.51.100.9');
    });

    it('trusts only the proxies listed in TRUST_PROXY', async () => {
      const instance = await appWith({
        NODE_ENV: 'production',
        REDIS_URL: 'redis://localhost:6379',
        TRUST_PROXY: '10.0.0.0/24',
      });
      expect(await ipFor(instance, PROXY, CLIENT)).toBe(CLIENT);
      expect(await ipFor(instance, '10.0.1.1', CLIENT)).toBe('10.0.1.1');
    });

    it('accepts a hop count', async () => {
      const instance = await appWith({
        NODE_ENV: 'production',
        REDIS_URL: 'redis://localhost:6379',
        TRUST_PROXY: '1',
      });
      expect(await ipFor(instance, '198.51.100.9', `6.6.6.6, ${CLIENT}`)).toBe(CLIENT);
    });
  });

  describe('client IP vouched for by the web server', () => {
    const clientIpFor = async (
      instance: FastifyInstance,
      headers: Record<string, string>,
    ): Promise<string> => {
      const res = await instance.inject({ url: '/test-ip', remoteAddress: PROXY, headers });
      return (res.json() as { clientIp: string }).clientIp;
    };

    it('uses the forwarded IP only with the right secret', async () => {
      const instance = await appWith({ WEB_PROXY_SECRET });
      expect(
        await clientIpFor(instance, {
          [CLIENT_IP_HEADER]: CLIENT,
          [PROXY_SECRET_HEADER]: WEB_PROXY_SECRET,
        }),
      ).toBe(CLIENT);
      expect(
        await clientIpFor(instance, {
          [CLIENT_IP_HEADER]: CLIENT,
          [PROXY_SECRET_HEADER]: 'wrong'.padEnd(32, '-'),
        }),
      ).toBe(PROXY);
      expect(await clientIpFor(instance, { [CLIENT_IP_HEADER]: CLIENT })).toBe(PROXY);
    });

    it('ignores a value that is not an IP address', async () => {
      const instance = await appWith({ WEB_PROXY_SECRET });
      expect(
        await clientIpFor(instance, {
          [CLIENT_IP_HEADER]: `${CLIENT}, 6.6.6.6`,
          [PROXY_SECRET_HEADER]: WEB_PROXY_SECRET,
        }),
      ).toBe(PROXY);
    });

    it('ignores the header entirely when no secret is configured', async () => {
      const instance = await appWith({});
      expect(
        await clientIpFor(instance, {
          [CLIENT_IP_HEADER]: CLIENT,
          [PROXY_SECRET_HEADER]: WEB_PROXY_SECRET,
        }),
      ).toBe(PROXY);
    });
  });
});
