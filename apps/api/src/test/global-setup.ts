import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url));

/** Runs once before the api tests: applies all migrations to TEST_DATABASE_URL. */
export default async function setup(): Promise<void> {
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
    throw new Error('Failed to run migrations against TEST_DATABASE_URL. Is Postgres running?', {
      cause: error,
    });
  } finally {
    await pool.end();
  }
}
