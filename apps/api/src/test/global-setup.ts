import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Redis } from 'ioredis';
import pg from 'pg';
import type { TestProject } from 'vitest/node';

const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url));

declare module 'vitest' {
  export interface ProvidedContext {
    testRedisUrl: string | null;
  }
}

export default async function setup(project: TestProject): Promise<void> {
  project.provide('testRedisUrl', await reachableRedisUrl());
  await migrateTestDatabase();
}

async function reachableRedisUrl(): Promise<string | null> {
  const url = process.env.TEST_REDIS_URL ?? process.env.REDIS_URL ?? 'redis://localhost:6379';
  const client = new Redis(url, {
    lazyConnect: true,
    connectTimeout: 2_000,
    maxRetriesPerRequest: 0,
    retryStrategy: () => null,
  });
  client.on('error', () => {});
  try {
    await client.connect();
    await client.ping();
    return url;
  } catch {
    // The URL isn't printed: it may hold a password.
    console.warn(
      '\n[api] Redis is not reachable (TEST_REDIS_URL, else REDIS_URL, else redis://localhost:6379):\n' +
        '      tests that need Redis (realtime, /ready) will be SKIPPED. Start it with `pnpm infra:up`.\n',
    );
    return null;
  } finally {
    client.disconnect();
  }
}

async function migrateTestDatabase(): Promise<void> {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    console.warn(
      '\n[api] TEST_DATABASE_URL is not set: database tests will be SKIPPED.\n' +
        '      Set it in the root .env (see .env.example) to run them.\n',
    );
    return;
  }
  if (url === process.env.DATABASE_URL) {
    throw new Error('TEST_DATABASE_URL must not be the same as DATABASE_URL.');
  }

  const pool = new pg.Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 5_000 });
  try {
    await migrate(drizzle({ client: pool }), { migrationsFolder });
  } catch (error) {
    const message = 'Failed to run migrations against TEST_DATABASE_URL. Is Postgres running?';
    // Printed as well as thrown: Vitest 5.0.5 can crash printing global-setup errors ("code.charCodeAt is not a function").
    console.error(`\n[api] ${message}\n`);
    throw new Error(message, { cause: error });
  } finally {
    await pool.end();
  }
}
