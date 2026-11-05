import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import fp from 'fastify-plugin';
import pg from 'pg';
import * as schema from '../db/schema/index.js';

// What drizzle() returns: `$client` is the pool (tests spy on it to count queries).
export type Database = NodePgDatabase<typeof schema> & { $client: pg.Pool };

declare module 'fastify' {
  interface FastifyInstance {
    db: Database;
  }
}

export interface DbPluginOptions {
  databaseUrl: string;
  poolMax: number;
}

// fastify-plugin so `app.db` is visible outside this plugin's scope. TLS comes from the URL (sslmode=require).
export const dbPlugin = fp<DbPluginOptions>(
  async (app, { databaseUrl, poolMax }) => {
    const pool = new pg.Pool({
      connectionString: databaseUrl,
      max: poolMax,
      connectionTimeoutMillis: 5_000,
    });

    // Without a listener, an error on an idle client (e.g. Postgres restarted) crashes the process.
    pool.on('error', (err) => app.log.error({ err }, 'idle database client error'));

    app.decorate('db', drizzle({ client: pool, schema }));

    app.addHook('onClose', async () => {
      await pool.end();
    });
  },
  { name: 'db' },
);
