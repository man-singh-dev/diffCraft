import { randomUUID } from 'node:crypto';
import { ErrorResponseSchema } from '@diffcraft/shared';
import type { FastifyInstance, InjectOptions } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { createUserWithSession } from '../test/fixtures.js';
import { testDatabaseUrl, UNUSED_DATABASE_URL } from '../test/db.js';
import { describeWithDbAndRedis, testRedisUrl, UNUSED_REDIS_URL } from '../test/redis.js';
import { CLIENT_IP_HEADER, PROXY_SECRET_HEADER } from './client-ip.js';
import { createMemoryCounter } from './rate-limit.js';

const WEB_PROXY_SECRET = 'test-web-proxy-secret'.padEnd(32, '-');
const apps: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

async function appWith(env: Record<string, string> = {}) {
  const app = await buildApp(
    loadConfig({
      LOG_LEVEL: 'silent',
      DATABASE_URL: testDatabaseUrl ?? UNUSED_DATABASE_URL,
      REDIS_URL: testRedisUrl ?? UNUSED_REDIS_URL,
      RATE_LIMIT_PREFIX: `test:rl:${randomUUID()}:`,
      MAIL_TRANSPORT: 'log',
      AI_PROVIDER: 'disabled',
      ...env,
    }),
    { relay: { enabled: false }, ai: { worker: false } },
  );
  apps.push(app);
  return app;
}

const login = (app: FastifyInstance, email: string, extra: Partial<InjectOptions> = {}) =>
  app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email },
    ...extra,
  });

function expectRateLimited(res: Awaited<ReturnType<FastifyInstance['inject']>>) {
  expect(res.statusCode).toBe(429);
  const body = ErrorResponseSchema.parse(res.json());
  expect(body.error.code).toBe('rate_limited');
  expect(body.error.message).toMatch(/^Too many requests\. Try again in \d+ (seconds?|minutes)\.$/);
  const retryAfter = Number(res.headers['retry-after']);
  expect(retryAfter).toBeGreaterThan(0);
  expect(body.error.details).toEqual({ retryAfterSeconds: retryAfter });
  expect(res.headers['ratelimit-limit']).toBeDefined();
  expect(res.headers['ratelimit-remaining']).toBe('0');
  expect(res.headers['ratelimit-reset']).toBeDefined();
}

describe.skipIf(!testRedisUrl)('rate limits (Redis)', () => {
  it('limits login per IP, separately for each IP', async () => {
    const app = await appWith({ RATE_LIMIT_LOGIN_PER_IP_PER_MINUTE: '3' });
    for (let i = 0; i < 3; i++) {
      expect((await login(app, `${randomUUID()}@example.com`)).statusCode).toBe(422);
    }
    expectRateLimited(await login(app, `${randomUUID()}@example.com`));
    expect((await login(app, 'a@example.com', { remoteAddress: '198.51.100.4' })).statusCode).toBe(
      422,
    );
  });

  it('limits login per email across IPs, ignoring case and spaces', async () => {
    const app = await appWith({ RATE_LIMIT_LOGIN_PER_EMAIL_PER_15_MINUTES: '2' });
    const email = `${randomUUID()}@example.com`;
    expect((await login(app, email, { remoteAddress: '198.51.100.1' })).statusCode).toBe(422);
    expect(
      (await login(app, ` ${email.toUpperCase()} `, { remoteAddress: '198.51.100.2' })).statusCode,
    ).toBe(422);
    const res = await login(app, email, { remoteAddress: '198.51.100.3' });
    expectRateLimited(res);
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(14 * 60);
    expect((await login(app, `${randomUUID()}@example.com`)).statusCode).toBe(422);
  });

  it('limits registration per IP', async () => {
    const app = await appWith({ RATE_LIMIT_REGISTER_PER_IP_PER_HOUR: '2' });
    const register = () =>
      app.inject({ method: 'POST', url: '/api/v1/auth/register', payload: {} });
    expect((await register()).statusCode).toBe(422);
    expect((await register()).statusCode).toBe(422);
    expectRateLimited(await register());
  });

  it('has a global per-IP limit that skips /health and /ready', async () => {
    const app = await appWith({ RATE_LIMIT_GLOBAL_PER_MINUTE: '2' });
    for (let i = 0; i < 4; i++) {
      expect((await app.inject({ url: '/health' })).statusCode).toBe(200);
      expect((await app.inject({ url: '/ready' })).statusCode).not.toBe(429);
    }
    const me = () => app.inject({ url: '/api/v1/auth/me' });
    expect((await me()).statusCode).toBe(401);
    expect((await me()).statusCode).toBe(401);
    expectRateLimited(await me());
  });

  it('shares counters between instances through Redis', async () => {
    const prefix = `test:rl:${randomUUID()}:`;
    const env = { RATE_LIMIT_PREFIX: prefix, RATE_LIMIT_LOGIN_PER_IP_PER_MINUTE: '3' };
    const [first, second] = await Promise.all([appWith(env), appWith(env)]);
    expect((await login(first, `${randomUUID()}@example.com`)).statusCode).toBe(422);
    expect((await login(second, `${randomUUID()}@example.com`)).statusCode).toBe(422);
    expect((await login(first, `${randomUUID()}@example.com`)).statusCode).toBe(422);
    expectRateLimited(await login(second, `${randomUUID()}@example.com`));
  });

  it('counts the client IP the web server vouches for, not the web server', async () => {
    const app = await appWith({ WEB_PROXY_SECRET, RATE_LIMIT_LOGIN_PER_IP_PER_MINUTE: '1' });
    const viaWeb = (clientIp: string, secret = WEB_PROXY_SECRET) =>
      login(app, `${randomUUID()}@example.com`, {
        headers: { [CLIENT_IP_HEADER]: clientIp, [PROXY_SECRET_HEADER]: secret },
      });
    expect((await viaWeb('203.0.113.10')).statusCode).toBe(422);
    expect((await viaWeb('203.0.113.11')).statusCode).toBe(422);
    expectRateLimited(await viaWeb('203.0.113.10'));
    // A forged header without the secret counts against the real peer address.
    expect((await viaWeb('203.0.113.12', 'wrong'.padEnd(32, '-'))).statusCode).toBe(422);
    expectRateLimited(await viaWeb('203.0.113.13', 'wrong'.padEnd(32, '-')));
  });
});

describeWithDbAndRedis('per-user rate limits', () => {
  it('limits realtime tickets per user', async () => {
    const app = await appWith({ RATE_LIMIT_TICKET_PER_USER_PER_MINUTE: '2' });
    const [alice, bob] = await Promise.all([
      createUserWithSession(app.db),
      createUserWithSession(app.db),
    ]);
    const ticket = (cookies: Record<string, string>) =>
      app.inject({ method: 'POST', url: '/api/v1/realtime/ticket', cookies });
    expect((await ticket(alice.cookies)).statusCode).toBe(200);
    expect((await ticket(alice.cookies)).statusCode).toBe(200);
    expectRateLimited(await ticket(alice.cookies));
    expect((await ticket(bob.cookies)).statusCode).toBe(200);
  });
});

describe('when Redis is unavailable', () => {
  it('lets general traffic through but keeps login limits per instance', async () => {
    const app = await appWith({
      REDIS_URL: UNUSED_REDIS_URL,
      RATE_LIMIT_GLOBAL_PER_MINUTE: '1',
      RATE_LIMIT_LOGIN_PER_IP_PER_MINUTE: '2',
    });
    for (let i = 0; i < 3; i++) {
      expect((await app.inject({ url: '/api/v1/auth/me' })).statusCode).toBe(401);
    }
    expect((await login(app, `${randomUUID()}@example.com`)).statusCode).toBe(422);
    expect((await login(app, `${randomUUID()}@example.com`)).statusCode).toBe(422);
    expectRateLimited(await login(app, `${randomUUID()}@example.com`));
  });
});

describe('createMemoryCounter', () => {
  it('counts within a window and starts over after it', () => {
    const count = createMemoryCounter();
    expect(count('k', 1000, 0)).toEqual({ current: 1, ttl: 1000 });
    expect(count('k', 1000, 400)).toEqual({ current: 2, ttl: 600 });
    expect(count('k', 1000, 1000)).toEqual({ current: 1, ttl: 1000 });
  });

  it('never holds more than its maximum number of keys', () => {
    const count = createMemoryCounter(2);
    count('a', 1000, 0);
    count('b', 1000, 0);
    count('c', 1000, 0);
    expect(count('a', 1000, 1).current).toBe(1);
    expect(count('c', 1000, 1).current).toBe(2);
  });
});
