import type { HealthResponse } from '@diffcraft/shared';
import type { FastifyPluginAsync } from 'fastify';

/** Liveness check: reports the process is up. Must not touch any external dependency. */
export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Reply: HealthResponse }>('/health', async () => ({
    status: 'ok',
    uptimeSeconds: process.uptime(),
    timestamp: new Date().toISOString(),
  }));
};
