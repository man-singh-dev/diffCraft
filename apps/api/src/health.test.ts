import { HealthResponseSchema } from '@diffcraft/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { UNUSED_DATABASE_URL } from './test/db.js';

describe('GET /health', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    // Liveness must not depend on the database, so point it at one that doesn't exist.
    app = await buildApp(loadConfig({ LOG_LEVEL: 'silent', DATABASE_URL: UNUSED_DATABASE_URL }));
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 200 with a valid HealthResponse', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });

    expect(res.statusCode).toBe(200);
    const body = HealthResponseSchema.parse(res.json());
    expect(body.status).toBe('ok');
  });
});
