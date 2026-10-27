import { randomUUID } from 'node:crypto';
import { ErrorResponseSchema, PublicUserSchema } from '@diffcraft/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';
import { sessions, users } from '../../db/schema/index.js';
import { describeWithDb, testDatabaseUrl } from '../../test/db.js';
import { hashSessionToken, SESSION_COOKIE_NAME, SESSION_TTL_SECONDS } from './session.js';

const REGISTER_URL = '/api/v1/auth/register';
const LOGIN_URL = '/api/v1/auth/login';
const LOGOUT_URL = '/api/v1/auth/logout';
const ME_URL = '/api/v1/auth/me';
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

describeWithDb('login, /me and logout', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp(
      loadConfig({ LOG_LEVEL: 'silent', NODE_ENV: 'test', DATABASE_URL: testDatabaseUrl }),
    );
  });

  afterAll(async () => {
    await app.close();
  });

  /** Registers a fresh user and returns its email and public data. */
  const createUser = async () => {
    const email = uniqueEmail();
    const res = await app.inject({
      method: 'POST',
      url: REGISTER_URL,
      payload: { email, password: PASSWORD, displayName: 'Ada' },
    });
    expect(res.statusCode).toBe(201);
    return { email, user: PublicUserSchema.parse(res.json()) };
  };

  const login = (email: string, password = PASSWORD) =>
    app.inject({ method: 'POST', url: LOGIN_URL, payload: { email, password } });

  /** Logs in and returns the raw session token from Set-Cookie. */
  const loginToken = async (email: string) => {
    const res = await login(email);
    expect(res.statusCode).toBe(200);
    const cookie = res.cookies.find((c) => c.name === SESSION_COOKIE_NAME);
    if (!cookie) throw new Error('no session cookie');
    return cookie.value;
  };

  const me = (token?: string) =>
    app.inject({
      method: 'GET',
      url: ME_URL,
      ...(token !== undefined && { cookies: { [SESSION_COOKIE_NAME]: token } }),
    });

  const sessionRow = async (id: string) => {
    const [row] = await app.db.select().from(sessions).where(eq(sessions.id, id));
    return row;
  };

  it('logs in: 200 with the user and a hardened session cookie', async () => {
    const { email, user } = await createUser();
    const res = await login(email);

    expect(res.statusCode).toBe(200);
    expect(PublicUserSchema.strict().parse(res.json())).toEqual(user);

    const setCookie = String(res.headers['set-cookie']);
    expect(setCookie).toMatch(new RegExp(`^${SESSION_COOKIE_NAME}=`));
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Lax');
    expect(setCookie).toContain('Path=/');
    expect(setCookie).toContain(`Max-Age=${SESSION_TTL_SECONDS}`);
    expect(setCookie).not.toContain('Secure');
  });

  it('stores only a hash of the session token', async () => {
    const { email, user } = await createUser();
    const token = await loginToken(email);

    expect(await sessionRow(token)).toBeUndefined();
    const row = await sessionRow(hashSessionToken(token));
    expect(row?.userId).toBe(user.id);
  });

  it('accepts the email in a different case', async () => {
    const { email, user } = await createUser();
    const res = await login(`  ${email.toUpperCase()} `);

    expect(res.statusCode).toBe(200);
    expect(PublicUserSchema.parse(res.json()).id).toBe(user.id);
  });

  it('returns the same 401 body for a wrong password and an unknown email', async () => {
    const { email } = await createUser();
    const wrongPassword = await login(email, 'wrong password!');
    const unknownEmail = await login(uniqueEmail());

    expect(wrongPassword.statusCode).toBe(401);
    expect(unknownEmail.statusCode).toBe(401);
    expect(wrongPassword.body).toBe(unknownEmail.body);
    expect(ErrorResponseSchema.parse(wrongPassword.json())).toEqual({
      error: { code: 'invalid_credentials', message: 'Invalid email or password' },
    });
    expect(wrongPassword.headers['set-cookie']).toBeUndefined();
  });

  it('treats a corrupted stored hash as a failed login (401, not 500)', async () => {
    const { email, user } = await createUser();
    await app.db
      .update(users)
      .set({ passwordHash: 'not-an-argon2-hash' })
      .where(eq(users.id, user.id));

    const res = await login(email);

    expect(res.statusCode).toBe(401);
    expect(ErrorResponseSchema.parse(res.json()).error.code).toBe('invalid_credentials');
  });

  it('issues a new session on every login and drops the one the browser sent', async () => {
    const { email } = await createUser();
    const oldToken = await loginToken(email);

    const res = await app.inject({
      method: 'POST',
      url: LOGIN_URL,
      payload: { email, password: PASSWORD },
      cookies: { [SESSION_COOKIE_NAME]: oldToken },
    });
    const newToken = res.cookies.find((c) => c.name === SESSION_COOKIE_NAME)?.value;

    expect(newToken).toBeDefined();
    expect(newToken).not.toBe(oldToken);
    expect(await sessionRow(hashSessionToken(oldToken))).toBeUndefined();
  });

  it('GET /me: 401 without a cookie or with an unknown token', async () => {
    for (const res of [await me(), await me('not-a-real-token')]) {
      expect(res.statusCode).toBe(401);
      expect(ErrorResponseSchema.parse(res.json()).error.code).toBe('unauthenticated');
    }
  });

  it('GET /me: 200 with the logged-in user', async () => {
    const { email, user } = await createUser();
    const res = await me(await loginToken(email));

    expect(res.statusCode).toBe(200);
    expect(PublicUserSchema.strict().parse(res.json())).toEqual(user);
  });

  it('logout: 204, deletes the session and clears the cookie; the old cookie stops working', async () => {
    const { email } = await createUser();
    const token = await loginToken(email);

    const res = await app.inject({
      method: 'POST',
      url: LOGOUT_URL,
      cookies: { [SESSION_COOKIE_NAME]: token },
    });

    expect(res.statusCode).toBe(204);
    expect(String(res.headers['set-cookie'])).toMatch(
      new RegExp(`^${SESSION_COOKIE_NAME}=;.*Max-Age=0`),
    );
    expect(await sessionRow(hashSessionToken(token))).toBeUndefined();
    expect((await me(token)).statusCode).toBe(401);
  });

  it('logout works when not logged in', async () => {
    const res = await app.inject({ method: 'POST', url: LOGOUT_URL });
    expect(res.statusCode).toBe(204);
  });

  it('rejects an expired session and deletes it', async () => {
    const { email } = await createUser();
    const token = await loginToken(email);
    const id = hashSessionToken(token);
    await app.db
      .update(sessions)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(sessions.id, id));

    const res = await me(token);

    expect(res.statusCode).toBe(401);
    expect(ErrorResponseSchema.parse(res.json()).error.code).toBe('unauthenticated');
    expect(await sessionRow(id)).toBeUndefined();
  });
});
