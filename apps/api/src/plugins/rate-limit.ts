import { createHash } from 'node:crypto';
import rateLimit, { normalizeIP } from '@fastify/rate-limit';
import type { FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import fp from 'fastify-plugin';
import type { Redis } from 'ioredis';
import type { Config } from '../config.js';
import { AppError } from '../errors.js';
import { truncateIp } from '../logger.js';
import { closeRedisClient, createRedisClient } from './redis.js';

declare module 'fastify' {
  interface FastifyInstance {
    limit(name: LimitName): preHandlerAsyncHookHandler;
  }
}

export class RateLimitedError extends AppError {
  constructor(retryAfterSeconds: number) {
    super(429, 'rate_limited', `Too many requests. Try again in ${waitText(retryAfterSeconds)}.`, {
      retryAfterSeconds,
    });
  }
}

function waitText(seconds: number): string {
  if (seconds <= 60) return seconds === 1 ? '1 second' : `${seconds} seconds`;
  const minutes = Math.ceil(seconds / 60);
  return `${minutes} minutes`;
}

const MINUTE = 60_000;

export type LimitName =
  | 'login-ip'
  | 'login-email'
  | 'register-ip'
  | 'resend-user'
  | 'ticket-user'
  | 'analysis-user'
  | 'comment-user';

// These fall back to per-instance memory counters when Redis fails; every other limit fails open.
const MEMORY_FALLBACK: ReadonlySet<string> = new Set<LimitName>([
  'login-ip',
  'login-email',
  'register-ip',
]);

interface LimitSpec {
  max: number;
  windowMs: number;
  identity: (request: FastifyRequest) => string | null;
}

const ipOf = (request: FastifyRequest) => normalizeIP(request.clientIp);
const userOrIp = (request: FastifyRequest) =>
  request.user ? `user:${request.user.id}` : `ip:${ipOf(request)}`;

function emailOf(request: FastifyRequest): string | null {
  const email: unknown = (request.body as { email?: unknown } | null | undefined)?.email;
  if (typeof email !== 'string') return null;
  const normalized = email.trim().toLowerCase();
  return normalized === '' ? null : normalized;
}

function limitSpecs(config: Config): Record<LimitName, LimitSpec> {
  const perMinute = (max: number, identity: LimitSpec['identity']) => ({
    max,
    windowMs: MINUTE,
    identity,
  });
  return {
    'login-ip': perMinute(config.RATE_LIMIT_LOGIN_PER_IP_PER_MINUTE, ipOf),
    'login-email': {
      max: config.RATE_LIMIT_LOGIN_PER_EMAIL_PER_15_MINUTES,
      windowMs: 15 * MINUTE,
      identity: emailOf,
    },
    'register-ip': {
      max: config.RATE_LIMIT_REGISTER_PER_IP_PER_HOUR,
      windowMs: 60 * MINUTE,
      identity: ipOf,
    },
    'resend-user': {
      max: config.RATE_LIMIT_RESEND_PER_USER_PER_HOUR,
      windowMs: 60 * MINUTE,
      identity: userOrIp,
    },
    'ticket-user': perMinute(config.RATE_LIMIT_TICKET_PER_USER_PER_MINUTE, userOrIp),
    'analysis-user': perMinute(config.RATE_LIMIT_ANALYSIS_PER_USER_PER_MINUTE, userOrIp),
    'comment-user': perMinute(config.RATE_LIMIT_COMMENTS_PER_USER_PER_MINUTE, userOrIp),
  };
}

// Hashed so Redis keys and logs never hold an email or an IP.
const hashed = (identity: string) =>
  createHash('sha256').update(identity).digest('hex').slice(0, 32);
const limitKey = (name: string, identity: string) => `${name}:${hashed(identity)}`;

const INCR_SCRIPT = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return {current, ttl}
`;

type LimitRedis = Redis & {
  diffcraftLimitIncr(key: string, windowMs: number): Promise<[number, number]>;
};

const MEMORY_MAX_KEYS = 10_000;

export function createMemoryCounter(maxKeys = MEMORY_MAX_KEYS) {
  const counters = new Map<string, { count: number; resetAt: number }>();
  return (key: string, windowMs: number, now = Date.now()) => {
    let entry = counters.get(key);
    if (!entry || entry.resetAt <= now) {
      counters.delete(key);
      if (counters.size >= maxKeys) {
        for (const [k, v] of counters) if (v.resetAt <= now) counters.delete(k);
        for (const k of counters.keys()) {
          if (counters.size < maxKeys) break;
          counters.delete(k);
        }
      }
      entry = { count: 0, resetAt: now + windowMs };
      counters.set(key, entry);
    }
    entry.count += 1;
    return { current: entry.count, ttl: entry.resetAt - now };
  };
}

type StoreCallback = (error: Error | null, result?: { current: number; ttl: number }) => void;

function createStore(redis: Redis, prefix: string, onRedisError: (err: Error) => void) {
  redis.defineCommand('diffcraftLimitIncr', { numberOfKeys: 1, lua: INCR_SCRIPT });
  const client = redis as LimitRedis;
  const memory = createMemoryCounter();

  return class LimitStore {
    incr(key: string, callback: StoreCallback, timeWindow: number): void {
      client.diffcraftLimitIncr(`${prefix}${key}`, timeWindow).then(
        ([current, ttl]) => callback(null, { current, ttl }),
        (err: Error) => {
          onRedisError(err);
          if (MEMORY_FALLBACK.has(key.slice(0, key.indexOf(':')))) {
            callback(null, memory(key, timeWindow));
          } else {
            callback(err);
          }
        },
      );
    }

    child(): this {
      return this;
    }
  };
}

// Bounded, so the API still starts (with the fallbacks) while Redis is down.
function waitUntilReady(redis: Redis, timeoutMs: number): Promise<void> {
  if (redis.status === 'ready') return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      redis.off('ready', done);
      redis.off('error', done);
      resolve();
    };
    const timer = setTimeout(done, timeoutMs);
    redis.once('ready', done);
    redis.once('error', done);
  });
}

const keyHint = (key: string) => key.slice(key.indexOf(':') + 1, key.indexOf(':') + 9);

export interface RateLimitPluginOptions {
  config: Config;
}

export const rateLimitPlugin = fp<RateLimitPluginOptions>(
  async (app, { config }) => {
    if (!config.RATE_LIMIT_ENABLED) {
      if (config.NODE_ENV === 'production') app.log.warn('rate limiting is disabled');
      const noop: preHandlerAsyncHookHandler = async () => {};
      app.decorate('limit', () => noop);
      return;
    }

    // Its own client without an offline queue: while Redis is down, commands fail at once instead of delaying every request.
    const redis = createRedisClient(config.REDIS_URL, app.log, 'rate-limit', {
      lazyConnect: false,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 0,
      commandTimeout: 1_000,
    });
    app.addHook('onClose', async () => {
      await closeRedisClient(redis);
    });
    await waitUntilReady(redis, 2_000);

    let lastWarning = 0;
    const onRedisError = (err: Error) => {
      if (Date.now() - lastWarning < MINUTE) return;
      lastWarning = Date.now();
      app.log.warn(
        { err: { name: err.name, message: err.message } },
        'rate limit store unavailable: general limits are off, auth limits count per instance',
      );
    };

    const logExceeded = (request: FastifyRequest, name: string, key: string) =>
      request.log.warn(
        { limit: name, key: keyHint(key), client: truncateIp(request.clientIp) },
        'rate limit exceeded',
      );

    await app.register(rateLimit, {
      global: true,
      hook: 'onRequest',
      max: config.RATE_LIMIT_GLOBAL_PER_MINUTE,
      timeWindow: MINUTE,
      store: createStore(redis, config.RATE_LIMIT_PREFIX, onRedisError),
      skipOnError: true,
      enableDraftSpec: true,
      keyGenerator: (request) => limitKey('global', ipOf(request)),
      onExceeded: (request, key) => logExceeded(request, 'global', key),
      errorResponseBuilder: (_request, context) =>
        new RateLimitedError(Math.max(1, Math.ceil(context.ttl / 1000))),
    });

    const handlers = new Map<LimitName, preHandlerAsyncHookHandler>();
    for (const [name, spec] of Object.entries(limitSpecs(config)) as [LimitName, LimitSpec][]) {
      // createRateLimit, not rateLimit(): the plugin runs one limiter per request, which would skip these after the global one.
      const check = app.createRateLimit({
        max: spec.max,
        timeWindow: spec.windowMs,
        keyGenerator: (request) => limitKey(name, spec.identity(request) ?? ''),
      });
      handlers.set(name, async (request, reply) => {
        if (spec.identity(request) === null) return;
        const result = await check(request);
        if (result.isAllowed || !result.isExceeded) return;
        const retryAfter = Math.max(1, result.ttlInSeconds);
        reply.headers({
          'ratelimit-limit': result.max,
          'ratelimit-remaining': 0,
          'ratelimit-reset': retryAfter,
          'retry-after': retryAfter,
        });
        logExceeded(request, name, result.key);
        throw new RateLimitedError(retryAfter);
      });
    }
    app.decorate('limit', (name: LimitName) => {
      const handler = handlers.get(name);
      if (!handler) throw new Error(`Unknown rate limit: ${name}`);
      return handler;
    });
  },
  { name: 'rate-limit', dependencies: ['client-ip'] },
);
