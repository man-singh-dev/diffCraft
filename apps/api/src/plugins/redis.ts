import type { FastifyBaseLogger } from 'fastify';
import fp from 'fastify-plugin';
import { Redis } from 'ioredis';

declare module 'fastify' {
  interface FastifyInstance {
    redis: Redis;
  }
}

export interface RedisPluginOptions {
  redisUrl: string;
}

// Lazy like the pg pool: nothing connects until the first command, so apps that never use Redis don't need it.
export function createRedisClient(
  redisUrl: string,
  log: FastifyBaseLogger,
  name: string,
  options: {
    maxRetriesPerRequest?: number | null;
    lazyConnect?: boolean;
    enableOfflineQueue?: boolean;
    commandTimeout?: number;
  } = {},
): Redis {
  const client = new Redis(redisUrl, {
    lazyConnect: true,
    connectTimeout: 5_000,
    maxRetriesPerRequest: 1,
    connectionName: `diffcraft-api-${name}`,
    ...options,
  });
  // Only the error itself: the connection URL may hold a password.
  client.on('error', (err: Error) =>
    log.error({ err: { name: err.name, message: err.message }, redis: name }, 'redis error'),
  );
  return client;
}

export async function closeRedisClient(client: Redis): Promise<void> {
  // quit() on a client that isn't connected would queue until it connects: drop the connection instead.
  if (client.status !== 'ready') {
    client.disconnect();
    return;
  }
  // quit() resolves on Redis's OK, before the socket is closed.
  const ended = new Promise((resolve) => client.once('end', resolve));
  try {
    await client.quit();
  } catch {
    client.disconnect();
  }
  await ended;
}

export const redisPlugin = fp<RedisPluginOptions>(
  async (app, { redisUrl }) => {
    const client = createRedisClient(redisUrl, app.log, 'main');
    app.decorate('redis', client);
    app.addHook('onClose', async () => {
      await closeRedisClient(client);
    });
  },
  { name: 'redis' },
);
