import Fastify, { type FastifyInstance } from 'fastify';
import type { Config } from './config.js';
import { loggerOptions } from './logger.js';
import { authRoutes } from './modules/auth/routes.js';
import { dbPlugin } from './plugins/db.js';
import { errorHandlerPlugin } from './plugins/error-handler.js';
import { healthRoutes } from './routes/health.js';
import { readyRoutes } from './routes/ready.js';

/** Builds the Fastify app without listening, so tests can use app.inject(). */
export async function buildApp(config: Config): Promise<FastifyInstance> {
  const app = Fastify({ logger: loggerOptions(config.LOG_LEVEL) });

  await app.register(errorHandlerPlugin);
  await app.register(dbPlugin, { databaseUrl: config.DATABASE_URL });

  await app.register(healthRoutes);
  await app.register(readyRoutes);
  await app.register(authRoutes, { prefix: '/api/v1/auth' });

  return app;
}
