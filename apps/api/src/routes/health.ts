import type { HealthResponse } from '@diffcraft/shared';
import type { FastifyPluginAsync } from 'fastify';

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Reply: HealthResponse }>('/health', { config: { rateLimit: false } }, async () => ({
    status: 'ok',
    uptimeSeconds: process.uptime(),
    timestamp: new Date().toISOString(),
  }));
};
