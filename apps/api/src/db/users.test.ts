import { afterAll, beforeAll, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { describeWithDb, testDatabaseUrl } from '../test/db.js';
import { users } from './schema/index.js';

const UNIQUE_VIOLATION = '23505';

describeWithDb('users table', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp(loadConfig({ LOG_LEVEL: 'silent', DATABASE_URL: testDatabaseUrl }));
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects an email that differs from an existing one only by case', async () => {
    const user = { displayName: 'Test', passwordHash: 'not-a-real-hash' };

    // Inside a transaction so nothing is left behind: the failed insert rolls it all back.
    const insertBoth = app.db.transaction(async (tx) => {
      await tx.insert(users).values({ ...user, email: 'A@x.com' });
      await tx.insert(users).values({ ...user, email: 'a@x.com' });
    });

    await expect(insertBoth).rejects.toMatchObject({
      cause: { code: UNIQUE_VIOLATION, constraint: 'users_email_lower_unique' },
    });
  });
});
