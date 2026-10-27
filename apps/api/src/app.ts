import cookie from '@fastify/cookie';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Config } from './config.js';
import { loggerOptions } from './logger.js';
import { requestUserPlugin } from './modules/auth/require-auth.js';
import { authRoutes } from './modules/auth/routes.js';
import { csrfPlugin } from './plugins/csrf.js';
import { dbPlugin } from './plugins/db.js';
import { errorHandlerPlugin } from './plugins/error-handler.js';
import { healthRoutes } from './routes/health.js';
import { readyRoutes } from './routes/ready.js';

/** Builds the Fastify app without listening, so tests can use app.inject(). */
export async function buildApp(config: Config): Promise<FastifyInstance> {
  const app = Fastify({
    logger: loggerOptions(config.LOG_LEVEL),
    // In production the API sits behind the host's proxy, so the TCP peer is the proxy, not the
    // client. Only trusted proxy addresses are skipped (not `true`, which would believe any
    // X-Forwarded-For entry a client sends), so request.ip is the real client.
    trustProxy: config.NODE_ENV === 'production' ? config.TRUST_PROXY : false,
  });

  await app.register(errorHandlerPlugin);
  await app.register(csrfPlugin, { webOrigin: config.WEB_ORIGIN });
  await app.register(dbPlugin, { databaseUrl: config.DATABASE_URL, poolMax: config.DB_POOL_MAX });
  // No `secret`: the session cookie is a random token checked against the database, not signed.
  await app.register(cookie);
  await app.register(requestUserPlugin);

  await app.register(healthRoutes);
  await app.register(readyRoutes);
  await app.register(authRoutes, {
    prefix: '/api/v1/auth',
    secureCookies: config.NODE_ENV === 'production',
  });

  return app;
}
