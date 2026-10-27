import { ErrorResponseSchema } from '@diffcraft/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { UNUSED_DATABASE_URL } from '../test/db.js';

const WEB_ORIGIN = 'http://localhost:3000';
// Logout without a cookie never touches the database, so these tests need none.
const LOGOUT_URL = '/api/v1/auth/logout';

describe('CSRF origin check', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp(
      loadConfig({ LOG_LEVEL: 'silent', WEB_ORIGIN, DATABASE_URL: UNUSED_DATABASE_URL }),
    );
  });

  afterAll(async () => {
    await app.close();
  });

  const post = (headers: Record<string, string>) =>
    app.inject({ method: 'POST', url: LOGOUT_URL, headers });

  it('rejects a POST from another origin with 403 forbidden_origin', async () => {
    const res = await post({ origin: 'https://evil.example' });

    expect(res.statusCode).toBe(403);
    expect(ErrorResponseSchema.parse(res.json()).error.code).toBe('forbidden_origin');
  });

  it('rejects the opaque "null" origin', async () => {
    expect((await post({ origin: 'null' })).statusCode).toBe(403);
  });

  it('allows a POST from WEB_ORIGIN', async () => {
    expect((await post({ origin: WEB_ORIGIN })).statusCode).toBe(204);
  });

  it('allows a POST without an Origin header (non-browser clients)', async () => {
    expect((await post({})).statusCode).toBe(204);
  });

  it('does not check safe methods', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: 'https://evil.example' },
    });
    expect(res.statusCode).toBe(200);
  });
});
