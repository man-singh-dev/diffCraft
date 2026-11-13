import cookie from '@fastify/cookie';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Config } from './config.js';
import { loggerOptions } from './logger.js';
import { createMailer, type Mailer } from './mail/mailer.js';
import { mailerPlugin } from './mail/plugin.js';
import { aiPlugin, type AiPluginOptions } from './modules/ai/plugin.js';
import { requestUserPlugin } from './modules/auth/require-auth.js';
import { authRoutes } from './modules/auth/routes.js';
import {
  notificationsPlugin,
  type NotificationsPluginOptions,
} from './modules/notifications/plugin.js';
import { notificationRoutes } from './modules/notifications/routes.js';
import type { AccessOptions } from './modules/realtime/access.js';
import { realtimeRoutes } from './modules/realtime/routes.js';
import { realtimePlugin, type RealtimeLimits } from './modules/realtime/socket-server.js';
import { requestWorkspacePlugin } from './modules/workspaces/require-workspace-role.js';
import { workspaceRoutes } from './modules/workspaces/routes.js';
import { clientIpPlugin } from './plugins/client-ip.js';
import { csrfPlugin } from './plugins/csrf.js';
import { dbPlugin } from './plugins/db.js';
import { errorHandlerPlugin } from './plugins/error-handler.js';
import { rateLimitPlugin } from './plugins/rate-limit.js';
import { redisPlugin } from './plugins/redis.js';
import { securityHeadersPlugin } from './plugins/security-headers.js';
import { healthRoutes } from './routes/health.js';
import { readyRoutes } from './routes/ready.js';

function trustProxyOption(value: string | number) {
  if (typeof value === 'string') return value;
  return (_address: string, hop: number) => hop < value;
}

export async function buildApp(
  config: Config,
  deps: {
    mailer?: Mailer;
    realtimeLimits?: Partial<RealtimeLimits>;
    realtimeAccess?: Partial<AccessOptions>;
    relay?: NotificationsPluginOptions['relay'];
    ai?: Omit<AiPluginOptions, 'config'>;
  } = {},
): Promise<FastifyInstance> {
  const app = Fastify({
    logger: loggerOptions(config.LOG_LEVEL),
    // Trust only known proxy addresses, not `true`, which would believe any X-Forwarded-For a client sends.
    trustProxy: config.NODE_ENV === 'production' ? trustProxyOption(config.TRUST_PROXY) : false,
  });

  await app.register(errorHandlerPlugin);
  await app.register(securityHeadersPlugin, { hsts: config.NODE_ENV === 'production' });
  await app.register(clientIpPlugin, { proxySecret: config.WEB_PROXY_SECRET });
  await app.register(csrfPlugin, { webOrigin: config.WEB_ORIGIN });
  await app.register(dbPlugin, { databaseUrl: config.DATABASE_URL, poolMax: config.DB_POOL_MAX });
  await app.register(redisPlugin, { redisUrl: config.REDIS_URL });
  // No `secret`: the session cookie is a random token checked against the database, not signed.
  await app.register(cookie);
  await app.register(mailerPlugin, { mailer: deps.mailer ?? createMailer(config, app.log) });
  await app.register(requestUserPlugin);
  await app.register(rateLimitPlugin, { config });
  await app.register(requestWorkspacePlugin);
  // Before realtime: preClose hooks run in registration order, so the relay stops before Socket.IO closes.
  await app.register(notificationsPlugin, { ...(deps.relay && { relay: deps.relay }) });
  // Also before realtime: the worker finishes in-flight jobs, and publishes their results, before Socket.IO closes.
  await app.register(aiPlugin, { config, ...deps.ai });
  await app.register(realtimePlugin, {
    webOrigin: config.WEB_ORIGIN,
    redisUrl: config.REDIS_URL,
    ...(deps.realtimeLimits && { limits: deps.realtimeLimits }),
    ...(deps.realtimeAccess && { access: deps.realtimeAccess }),
  });

  await app.register(healthRoutes);
  await app.register(readyRoutes);
  await app.register(authRoutes, {
    prefix: '/api/v1/auth',
    secureCookies: config.NODE_ENV === 'production',
    webOrigin: config.WEB_ORIGIN,
  });
  await app.register(workspaceRoutes, { prefix: '/api/v1/workspaces' });
  await app.register(realtimeRoutes, { prefix: '/api/v1/realtime' });
  await app.register(notificationRoutes, { prefix: '/api/v1/notifications' });

  return app;
}
