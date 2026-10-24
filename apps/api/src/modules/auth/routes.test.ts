import { randomUUID } from 'node:crypto';
import { ErrorResponseSchema, PublicUserSchema } from '@diffcraft/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';
import { users } from '../../db/schema/index.js';
import { describeWithDb, testDatabaseUrl } from '../../test/db.js';

const REGISTER_URL = '/api/v1/auth/register';
const PASSWORD = 'correct horse battery staple';

// Test files run in parallel against one shared database: every email must be unique.
const uniqueEmail = () => `user-${randomUUID()}@example.com`;

describeWithDb('POST /api/v1/auth/register', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp(loadConfig({ LOG_LEVEL: 'silent', DATABASE_URL: testDatabaseUrl }));
  });

  afterAll(async () => {
    await app.close();
  });

  const register = (payload: Record<string, unknown>) =>
    app.inject({ method: 'POST', url: REGISTER_URL, payload });

  const storedUser = async (id: string) => {
    const [row] = await app.db.select().from(users).where(eq(users.id, id));
    if (!row) throw new Error(`user ${id} not found`);
    return row;
  };

  it('creates the user and returns 201 with the public user', async () => {
    const email = uniqueEmail();
    const res = await register({ email, password: PASSWORD, displayName: 'Ada' });

    expect(res.statusCode).toBe(201);
    const user = PublicUserSchema.strict().parse(res.json());
    expect(user).toMatchObject({ email, displayName: 'Ada' });
    expect(res.body).not.toContain(PASSWORD);
    expect(res.body).not.toContain('argon2');

    const row = await storedUser(user.id);
    expect(row.passwordHash).not.toBe(PASSWORD);
    expect(row.passwordHash.startsWith('$argon2id$')).toBe(true);
  });

  it('stores the email trimmed and lowercased', async () => {
    const email = uniqueEmail();
    const res = await register({
      email: `  ${email.toUpperCase()}  `,
      password: PASSWORD,
      displayName: 'Ada',
    });

    expect(res.statusCode).toBe(201);
    const user = PublicUserSchema.parse(res.json());
    expect(user.email).toBe(email);
    expect((await storedUser(user.id)).email).toBe(email);
  });

  it('returns 409 email_taken for an email that differs only by case', async () => {
    const email = uniqueEmail();
    const first = await register({ email, password: PASSWORD, displayName: 'Ada' });
    expect(first.statusCode).toBe(201);

    const res = await register({
      email: email.toUpperCase(),
      password: PASSWORD,
      displayName: 'B',
    });

    expect(res.statusCode).toBe(409);
    expect(ErrorResponseSchema.parse(res.json()).error.code).toBe('email_taken');
  });

  it('returns 422 for an invalid email', async () => {
    const res = await register({ email: 'not-an-email', password: PASSWORD, displayName: 'Ada' });

    expect(res.statusCode).toBe(422);
    const { error } = ErrorResponseSchema.parse(res.json());
    expect(error.code).toBe('validation_error');
    expect(error.details).toEqual([expect.objectContaining({ field: 'email' })]);
  });

  it('returns 422 for a short password without echoing it back', async () => {
    const shortPassword = 'short-pw1';
    const res = await register({
      email: uniqueEmail(),
      password: shortPassword,
      displayName: 'Ada',
    });

    expect(res.statusCode).toBe(422);
    const { error } = ErrorResponseSchema.parse(res.json());
    expect(error.code).toBe('validation_error');
    expect(error.details).toEqual([expect.objectContaining({ field: 'password' })]);
    expect(res.body).not.toContain(shortPassword);
  });

  it('returns 422 listing every missing field', async () => {
    const res = await register({});

    expect(res.statusCode).toBe(422);
    const { error } = ErrorResponseSchema.parse(res.json());
    expect(error.code).toBe('validation_error');
    const fields = (error.details as { field: string }[]).map((issue) => issue.field).sort();
    expect(fields).toEqual(['displayName', 'email', 'password']);
  });

  it('returns 422 when there is no body at all', async () => {
    const res = await app.inject({ method: 'POST', url: REGISTER_URL });

    expect(res.statusCode).toBe(422);
    expect(ErrorResponseSchema.parse(res.json()).error.code).toBe('validation_error');
  });
});
