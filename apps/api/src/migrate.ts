import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { loadConfig } from './config.js';

// Applies the pending drizzle/ migrations to DATABASE_URL, then exits. Run before the server
// starts (`start:prod`). '../drizzle' resolves to apps/api/drizzle from both src/ and dist/.
const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));

let databaseUrl: string;
try {
  databaseUrl = loadConfig().DATABASE_URL;
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

const pool = new pg.Pool({
  connectionString: databaseUrl,
  max: 1,
  connectionTimeoutMillis: 10_000,
});
try {
  await migrate(drizzle({ client: pool }), { migrationsFolder });
  console.log('migrations: up to date');
} catch (error) {
  console.error('migrations: failed', error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
