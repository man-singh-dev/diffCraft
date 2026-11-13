import { createHash, randomBytes } from 'node:crypto';
import type { CookieSerializeOptions } from '@fastify/cookie';
import { eq } from 'drizzle-orm';
import { sessions, users, type User } from '../../db/schema/index.js';
import type { Database } from '../../plugins/db.js';

/** Absolute, not sliding: a session ends 7 days after login, however much it is used. */
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

export const SESSION_COOKIE_NAME = 'diffcraft_session';

export type SessionUser = Omit<User, 'passwordHash'>;

// 32 bytes in base64url (no padding) is always 43 characters.
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

// SHA-256 is enough here (not for passwords): the token is 256 random bits, so there is nothing to brute-force.
export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

// Login and logout must use the same attributes.
export function sessionCookieOptions(secure: boolean): CookieSerializeOptions {
  return { httpOnly: true, sameSite: 'lax', path: '/', maxAge: SESSION_TTL_SECONDS, secure };
}

export async function createSession(
  db: Database,
  userId: string,
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000);
  await db.insert(sessions).values({ id: hashSessionToken(token), userId, expiresAt });
  return { token, expiresAt };
}

export interface EndedSession {
  id: string;
  userId: string;
}

export interface ActiveSession {
  id: string;
  user: SessionUser;
}

export async function findSession(
  db: Database,
  token: string,
  onExpired?: (session: EndedSession) => Promise<void>,
): Promise<ActiveSession | null> {
  if (!TOKEN_PATTERN.test(token)) return null;
  const id = hashSessionToken(token);

  const [row] = await db
    .select({
      expiresAt: sessions.expiresAt,
      user: {
        id: users.id,
        email: users.email,
        displayName: users.displayName,
        emailVerifiedAt: users.emailVerifiedAt,
        createdAt: users.createdAt,
        updatedAt: users.updatedAt,
      },
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(eq(sessions.id, id));

  if (!row) return null;
  if (row.expiresAt <= new Date()) {
    await db.delete(sessions).where(eq(sessions.id, id));
    await onExpired?.({ id, userId: row.user.id });
    return null;
  }
  return { id, user: row.user };
}

export async function deleteSession(db: Database, token: string): Promise<EndedSession | null> {
  const [row] = await db
    .delete(sessions)
    .where(eq(sessions.id, hashSessionToken(token)))
    .returning({ id: sessions.id, userId: sessions.userId });
  return row ?? null;
}
