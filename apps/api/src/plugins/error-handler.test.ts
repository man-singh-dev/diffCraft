import { ErrorResponseSchema } from '@diffcraft/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { AppError } from '../errors.js';
import { UNUSED_DATABASE_URL } from '../test/db.js';

describe('global error handler', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp(loadConfig({ LOG_LEVEL: 'silent', DATABASE_URL: UNUSED_DATABASE_URL }));
    app.get('/test/app-error', async () => {
      throw new AppError(418, 'teapot', 'I am a teapot.', { hint: 'tea' });
    });
    app.get('/test/crash', async () => {
      throw new Error('connection string postgres://secret@db leaked');
    });
    app.post('/test/echo', async (request) => request.body);
  });

  afterAll(async () => {
    await app.close();
  });

  it('sends an AppError with its status, code and details', async () => {
    const res = await app.inject({ method: 'GET', url: '/test/app-error' });

    expect(res.statusCode).toBe(418);
    expect(ErrorResponseSchema.parse(res.json())).toEqual({
      error: { code: 'teapot', message: 'I am a teapot.', details: { hint: 'tea' } },
    });
  });

  it('turns an unknown error into a generic 500 without internal details', async () => {
    const res = await app.inject({ method: 'GET', url: '/test/crash' });

    expect(res.statusCode).toBe(500);
    expect(ErrorResponseSchema.parse(res.json()).error.code).toBe('internal_error');
    expect(res.body).not.toContain('secret');
  });

  it('formats an unknown route as a 404 error', async () => {
    const res = await app.inject({ method: 'GET', url: '/nope' });

    expect(res.statusCode).toBe(404);
    expect(ErrorResponseSchema.parse(res.json()).error.code).toBe('not_found');
  });

  it("formats Fastify's own client errors (malformed JSON)", async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/test/echo',
      headers: { 'content-type': 'application/json' },
      payload: '{not json',
    });

    expect(res.statusCode).toBe(400);
    expect(ErrorResponseSchema.parse(res.json()).error.code).toBe('bad_request');
  });
});
