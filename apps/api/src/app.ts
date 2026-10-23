import Fastify, { type FastifyInstance } from 'fastify';
import type { Config } from './config.js';
import { healthRoutes } from './routes/health.js';

/** Builds the Fastify app without listening, so tests can use app.inject(). */
export async function buildApp(config: Config): Promise<FastifyInstance> {
  const app = Fastify({ logger: { level: config.LOG_LEVEL } });

  await app.register(healthRoutes);

  return app;
}
