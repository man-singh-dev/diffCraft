import { ReadyResponseSchema } from '@diffcraft/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { describeWithDb, testDatabaseUrl, UNUSED_DATABASE_URL } from './test/db.js';

describeWithDb('GET /ready (database up)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp(loadConfig({ LOG_LEVEL: 'silent', DATABASE_URL: testDatabaseUrl }));
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 200 {"status":"ready"}', async () => {
    const res = await app.inject({ method: 'GET', url: '/ready' });

    expect(res.statusCode).toBe(200);
    expect(ReadyResponseSchema.parse(res.json())).toEqual({ status: 'ready' });
  });
});

describe('GET /ready (database down)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    // Port 1 is closed, so the connection is refused.
    app = await buildApp(loadConfig({ LOG_LEVEL: 'silent', DATABASE_URL: UNUSED_DATABASE_URL }));
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 503 {"status":"not_ready"}', async () => {
    const res = await app.inject({ method: 'GET', url: '/ready' });

    expect(res.statusCode).toBe(503);
    expect(ReadyResponseSchema.parse(res.json())).toEqual({ status: 'not_ready' });
  });
});
