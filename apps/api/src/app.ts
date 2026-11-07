import cookie from '@fastify/cookie';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Config } from './config.js';
import { loggerOptions } from './logger.js';
import { createMailer, type Mailer } from './mail/mailer.js';
import { mailerPlugin } from './mail/plugin.js';
import { requestUserPlugin } from './modules/auth/require-auth.js';
import { authRoutes } from './modules/auth/routes.js';
import { requestWorkspacePlugin } from './modules/workspaces/require-workspace-role.js';
import { workspaceRoutes } from './modules/workspaces/routes.js';
import { csrfPlugin } from './plugins/csrf.js';
import { dbPlugin } from './plugins/db.js';
import { errorHandlerPlugin } from './plugins/error-handler.js';
import { healthRoutes } from './routes/health.js';
import { readyRoutes } from './routes/ready.js';

export async function buildApp(
  config: Config,
  deps: { mailer?: Mailer } = {},
): Promise<FastifyInstance> {
  const app = Fastify({
    logger: loggerOptions(config.LOG_LEVEL),
    // Trust only known proxy addresses, not `true`, which would believe any X-Forwarded-For a client sends.
    trustProxy: config.NODE_ENV === 'production' ? config.TRUST_PROXY : false,
  });

  await app.register(errorHandlerPlugin);
  await app.register(csrfPlugin, { webOrigin: config.WEB_ORIGIN });
  await app.register(dbPlugin, { databaseUrl: config.DATABASE_URL, poolMax: config.DB_POOL_MAX });
  // No `secret`: the session cookie is a random token checked against the database, not signed.
  await app.register(cookie);
  await app.register(mailerPlugin, { mailer: deps.mailer ?? createMailer(config, app.log) });
  await app.register(requestUserPlugin);
  await app.register(requestWorkspacePlugin);

  await app.register(healthRoutes);
  await app.register(readyRoutes);
  await app.register(authRoutes, {
    prefix: '/api/v1/auth',
    secureCookies: config.NODE_ENV === 'production',
    webOrigin: config.WEB_ORIGIN,
  });
  await app.register(workspaceRoutes, { prefix: '/api/v1/workspaces' });

  return app;
}
