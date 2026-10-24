import type { ReadyResponse } from '@diffcraft/shared';
import { sql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

const READY_TIMEOUT_MS = 2_000;

/** Readiness: can this instance serve traffic right now? Unlike /health, it checks the database. */
export const readyRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Reply: ReadyResponse }>('/ready', async (request, reply) => {
    try {
      await withTimeout(app.db.execute(sql`select 1`), READY_TIMEOUT_MS);
      return { status: 'ready' };
    } catch (err) {
      request.log.warn({ err }, 'readiness check failed');
      return reply.code(503).send({ status: 'not_ready' });
    }
  });
};

function withTimeout<T>(promise: PromiseLike<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
