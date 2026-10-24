import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import fp from 'fastify-plugin';
import pg from 'pg';
import * as schema from '../db/schema/index.js';

export type Database = NodePgDatabase<typeof schema>;

declare module 'fastify' {
  interface FastifyInstance {
    db: Database;
  }
}

export interface DbPluginOptions {
  databaseUrl: string;
}

/**
 * Creates a pg Pool and exposes a typed Drizzle instance as `app.db`.
 * The pool connects lazily (on the first query) and is closed when the app closes.
 * Wrapped in fastify-plugin so `app.db` is visible outside this plugin's scope.
 */
export const dbPlugin = fp<DbPluginOptions>(
  async (app, { databaseUrl }) => {
    const pool = new pg.Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 5_000 });

    // Without a listener, an error on an idle client (e.g. Postgres restarted) crashes the process.
    pool.on('error', (err) => app.log.error({ err }, 'idle database client error'));

    app.decorate('db', drizzle({ client: pool, schema }));

    app.addHook('onClose', async () => {
      await pool.end();
    });
  },
  { name: 'db' },
);
