import { readFileSync } from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';
import {
  ErrorResponseSchema,
  PublicUserSchema,
  ResendVerificationResponseSchema,
  VerifyEmailResponseSchema,
} from '@diffcraft/shared';
import { eq, sql } from 'drizzle-orm';
import type { FastifyBaseLogger, FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';
import { emailVerificationTokens, users } from '../../db/schema/index.js';
import { describeWithDb, testDatabaseUrl } from '../../test/db.js';
import { FakeMailer } from '../../test/fake-mailer.js';
import { createUserWithSession, type TestUser } from '../../test/fixtures.js';
import { hashSessionToken } from './session.js';
import { createVerificationToken, sendVerificationEmail } from './verification.js';

const WEB_ORIGIN = 'https://app.example.test';
const PASSWORD = 'correct horse battery staple';
const GENERIC = {
  code: 'invalid_token',
  message: 'This verification link is invalid or has expired.',
};

const uniqueEmail = () => `user-${randomUUID()}@example.com`;
const errorOf = (res: LightMyRequestResponse) => ErrorResponseSchema.parse(res.json()).error;

describe('sendVerificationEmail', () => {
  it('logs a failure without the token and reports it', async () => {
    const token = randomBytes(32).toString('base64url');
    const error = Object.assign(
      new Error(`550 rejected: ${WEB_ORIGIN}/verify-email?token=${token}`),
      {
        code: 'EENVELOPE',
      },
    );
    const mailer = { send: vi.fn().mockRejectedValue(error) };
    const log = { error: vi.fn() } as unknown as FastifyBaseLogger;

    const sent = await sendVerificationEmail(mailer, log, {
      webOrigin: WEB_ORIGIN,
      userId: 'u1',
      email: 'ada@example.com',
      token,
    });

    expect(sent).toBe(false);
    expect(log.error).toHaveBeenCalledOnce();
    const logged = JSON.stringify(vi.mocked(log.error).mock.calls);
    expect(logged).not.toContain(token);
    expect(logged).toContain('[redacted]');
    expect(logged).toContain('EENVELOPE');
  });

  it('builds the link from the web origin', async () => {
    const mailer = new FakeMailer();
    const log = { error: vi.fn() } as unknown as FastifyBaseLogger;
    await sendVerificationEmail(mailer, log, {
      webOrigin: `${WEB_ORIGIN}/`,
      userId: 'u1',
      email: 'ada@example.com',
      token: 'abc_-123',
    });
    expect(mailer.linksTo('ada@example.com')).toEqual([
      `${WEB_ORIGIN}/verify-email?token=abc_-123`,
    ]);
  });
});

describeWithDb('email verification', () => {
  let app: FastifyInstance;
  const mailer = new FakeMailer();

  beforeAll(async () => {
    app = await buildApp(
      loadConfig({
        LOG_LEVEL: 'silent',
        NODE_ENV: 'test',
        DATABASE_URL: testDatabaseUrl,
        WEB_ORIGIN,
      }),
      { mailer },
    );
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    mailer.failWith = null;
  });

  const register = (email: string) =>
    app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email, password: PASSWORD, displayName: 'Ada' },
    });

  const verify = (token: unknown) =>
    app.inject({ method: 'POST', url: '/api/v1/auth/verify-email', payload: { token } });

  const resend = (user?: TestUser) =>
    app.inject({
      method: 'POST',
      url: '/api/v1/auth/resend-verification',
      ...(user && { cookies: user.cookies }),
    });

  const me = async (user: TestUser) => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/auth/me', cookies: user.cookies });
    expect(res.statusCode).toBe(200);
    return PublicUserSchema.strict().parse(res.json());
  };

  const tokenFromLink = (link: string) => {
    const url = new URL(link);
    expect(url.origin + url.pathname).toBe(`${WEB_ORIGIN}/verify-email`);
    const token = url.searchParams.get('token');
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    return token!;
  };

  async function registered() {
    const email = uniqueEmail();
    const res = await register(email);
    expect(res.statusCode).toBe(201);
    const user = PublicUserSchema.strict().parse(res.json());
    const links = mailer.linksTo(email);
    return { email, user, links, token: links.length === 1 ? tokenFromLink(links[0]!) : null };
  }

  const tokenRows = (userId: string) =>
    app.db.select().from(emailVerificationTokens).where(eq(emailVerificationTokens.userId, userId));

  const verifiedAt = async (userId: string) => {
    const [row] = await app.db
      .select({ at: users.emailVerifiedAt })
      .from(users)
      .where(eq(users.id, userId));
    return row?.at ?? null;
  };

  it('register sends one email with a link; the database stores only the hash', async () => {
    const { email, user, links, token } = await registered();

    expect(user.emailVerified).toBe(false);
    expect(links).toHaveLength(1);
    expect(mailer.messages.filter((m) => m.to === email)).toHaveLength(1);

    const rows = await tokenRows(user.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.tokenHash).toBe(hashSessionToken(token!));
    expect(JSON.stringify(rows)).not.toContain(token);
    const ttlHours = (rows[0]!.expiresAt.getTime() - rows[0]!.createdAt.getTime()) / 3_600_000;
    expect(ttlHours).toBeCloseTo(24, 1);
  });

  it('verifies once; the same, an expired, a random or a malformed token get one generic 400', async () => {
    const { user, token } = await registered();

    const ok = await verify(token);
    expect(ok.statusCode).toBe(200);
    expect(VerifyEmailResponseSchema.parse(ok.json())).toEqual({ verified: true });
    expect(await verifiedAt(user.id)).toBeInstanceOf(Date);
    expect((await tokenRows(user.id))[0]!.usedAt).toBeInstanceOf(Date);

    const expired = await createVerificationToken(app.db, user.id);
    await app.db
      .update(emailVerificationTokens)
      .set({ expiresAt: sql`now() - interval '1 second'` })
      .where(eq(emailVerificationTokens.tokenHash, hashSessionToken(expired)));

    for (const bad of [token, expired, randomBytes(32).toString('base64url'), 'short', '']) {
      const res = await verify(bad);
      expect(res.statusCode, String(bad)).toBe(400);
      expect(errorOf(res)).toEqual(GENERIC);
    }
  });

  it('a second token of an already verified user is used up without changing the verification time', async () => {
    const { user, token } = await registered();
    const second = await createVerificationToken(app.db, user.id);
    expect((await verify(token)).statusCode).toBe(200);
    const first = await verifiedAt(user.id);

    expect((await verify(second)).statusCode).toBe(200);
    expect(await verifiedAt(user.id)).toEqual(first);
    expect((await verify(second)).statusCode).toBe(400);
  });

  it('two concurrent requests with the same token: exactly one 200 and one 400', async () => {
    for (let run = 0; run < 10; run++) {
      const { token } = await registered();
      const results = await Promise.all([verify(token), verify(token)]);
      expect(results.map((r) => r.statusCode).sort()).toEqual([200, 400]);
    }
  });

  it('a body without a token is a 422, and a foreign Origin is refused', async () => {
    const missing = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/verify-email',
      payload: {},
    });
    expect(missing.statusCode).toBe(422);
    expect(errorOf(missing).code).toBe('validation_error');

    const foreign = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/verify-email',
      headers: { origin: 'https://evil.example' },
      payload: { token: 'x' },
    });
    expect(foreign.statusCode).toBe(403);
    expect(errorOf(foreign).code).toBe('forbidden_origin');
  });

  it('still answers 201 when the email cannot be sent, with the user and token stored', async () => {
    mailer.failWith = new Error('connect ECONNREFUSED 127.0.0.1:1025');
    const email = uniqueEmail();

    const res = await register(email);

    expect(res.statusCode).toBe(201);
    const user = PublicUserSchema.parse(res.json());
    expect(user.email).toBe(email);
    expect(await tokenRows(user.id)).toHaveLength(1);
    expect(mailer.linksTo(email)).toEqual([]);
  });

  describe('resend', () => {
    it('sends a new link, throttles for 60 s with Retry-After, and works again after', async () => {
      const user = await createUserWithSession(app.db, { verified: false });
      const { email } = user;

      const first = await resend(user);
      expect(first.statusCode).toBe(200);
      expect(ResendVerificationResponseSchema.parse(first.json())).toEqual({
        alreadyVerified: false,
      });
      expect(mailer.linksTo(email)).toHaveLength(1);

      const throttled = await resend(user);
      expect(throttled.statusCode).toBe(429);
      expect(errorOf(throttled).code).toBe('verification_throttled');
      const retryAfter = Number(throttled.headers['retry-after']);
      expect(retryAfter).toBeGreaterThanOrEqual(1);
      expect(retryAfter).toBeLessThanOrEqual(60);
      expect(mailer.linksTo(email)).toHaveLength(1);

      await app.db
        .update(emailVerificationTokens)
        .set({ createdAt: sql`now() - interval '61 seconds'` })
        .where(eq(emailVerificationTokens.userId, user.id));
      expect((await resend(user)).statusCode).toBe(200);
      const links = mailer.linksTo(email);
      expect(links).toHaveLength(2);

      // Older unused links stay valid until they expire.
      expect((await verify(tokenFromLink(links[0]!))).statusCode).toBe(200);
      expect(await me(user)).toMatchObject({ emailVerified: true });
    });

    it('answers alreadyVerified for a verified user and sends nothing', async () => {
      const user = await createUserWithSession(app.db);
      const before = mailer.messages.length;
      const res = await resend(user);
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ alreadyVerified: true });
      expect(mailer.messages).toHaveLength(before);
    });

    it('needs a session', async () => {
      const res = await resend();
      expect(res.statusCode).toBe(401);
    });

    it('reports a failed send with 503', async () => {
      const user = await createUserWithSession(app.db, { verified: false });
      mailer.failWith = new Error('smtp down');
      const res = await resend(user);
      expect(res.statusCode).toBe(503);
      expect(errorOf(res).code).toBe('email_send_failed');
    });
  });

  it('/me reports emailVerified', async () => {
    const unverified = await createUserWithSession(app.db, { verified: false });
    expect((await me(unverified)).emailVerified).toBe(false);
    const verified = await createUserWithSession(app.db);
    expect((await me(verified)).emailVerified).toBe(true);
  });

  it('the migration backfill marks existing users verified as of their creation', async () => {
    const migration = readFileSync(
      new URL('../../../drizzle/0005_email_verification.sql', import.meta.url),
      'utf8',
    );
    const backfill = migration
      .split('--> statement-breakpoint')
      .map((statement) => statement.replace(/^\s*--.*$/gm, '').trim())
      .find((statement) => statement.startsWith('UPDATE "users"'));
    expect(backfill).toBe(
      'UPDATE "users" SET "email_verified_at" = "created_at" WHERE "email_verified_at" IS NULL;',
    );

    const createdAt = new Date('2026-01-02T03:04:05.000Z');
    const rollback = new Error('rollback');
    await expect(
      app.db.transaction(async (tx) => {
        const [old] = await tx
          .insert(users)
          .values({
            email: uniqueEmail(),
            displayName: 'Old',
            passwordHash: 'x',
            createdAt,
          })
          .returning({ id: users.id });
        await tx.execute(sql.raw(backfill!));
        const [row] = await tx
          .select({ at: users.emailVerifiedAt })
          .from(users)
          .where(eq(users.id, old!.id));
        expect(row?.at).toEqual(createdAt);
        // Never commit: the statement touches every unverified user in the shared test database.
        throw rollback;
      }),
    ).rejects.toBe(rollback);
  });
});
