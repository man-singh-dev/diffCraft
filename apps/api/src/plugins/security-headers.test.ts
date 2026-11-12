import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { UNUSED_DATABASE_URL } from '../test/db.js';

describe('security headers', () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  const appWith = async (env: Record<string, string> = {}) => {
    app = await buildApp(
      loadConfig({
        LOG_LEVEL: 'silent',
        RATE_LIMIT_ENABLED: 'false',
        DATABASE_URL: UNUSED_DATABASE_URL,
        MAIL_TRANSPORT: 'log',
        AI_PROVIDER: 'disabled',
        ...env,
      }),
    );
    return app;
  };

  it('sends nosniff, frame deny, no referrer and a locked-down CSP, without x-powered-by', async () => {
    const res = await (await appWith()).inject({ url: '/health' });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['content-security-policy']).toBe(
      "default-src 'none';frame-ancestors 'none'",
    );
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['strict-transport-security']).toBeUndefined();
  });

  it('marks auth responses, errors included, as not cacheable', async () => {
    const instance = await appWith();
    const me = await instance.inject({ url: '/api/v1/auth/me' });
    expect(me.statusCode).toBe(401);
    expect(me.headers['cache-control']).toBe('no-store');
    const login = await instance.inject({ method: 'POST', url: '/api/v1/auth/login', payload: {} });
    expect(login.headers['cache-control']).toBe('no-store');
    expect(login.headers['x-content-type-options']).toBe('nosniff');
  });

  it('sends HSTS only in production', async () => {
    const instance = await appWith({
      NODE_ENV: 'production',
      REDIS_URL: 'redis://localhost:6379',
    });
    const res = await instance.inject({ url: '/health' });
    expect(res.headers['strict-transport-security']).toBe('max-age=31536000; includeSubDomains');
  });
});
