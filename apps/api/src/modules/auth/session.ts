import { createHash, randomBytes } from 'node:crypto';
import type { CookieSerializeOptions } from '@fastify/cookie';
import { eq } from 'drizzle-orm';
import { sessions, users, type User } from '../../db/schema/index.js';
import type { Database } from '../../plugins/db.js';

/** Absolute lifetime: a session ends 7 days after login, however much it is used. */
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

export const SESSION_COOKIE_NAME = 'diffcraft_session';

/** A user as loaded for an authenticated request: everything except the password hash. */
export type SessionUser = Omit<User, 'passwordHash'>;

// 32 bytes in base64url (no padding) is always 43 characters.
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/**
 * The value stored in sessions.id. SHA-256 is enough here (but not for passwords):
 * the token is 256 random bits, so there is nothing to guess or look up in a dictionary,
 * and a fast hash is fine. Passwords are short and guessable, so they need a deliberately
 * slow, salted hash (Argon2id) to make brute-forcing a leaked hash expensive.
 */
export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Cookie attributes for the session cookie. Login and logout must use the same ones. */
export function sessionCookieOptions(secure: boolean): CookieSerializeOptions {
  return { httpOnly: true, sameSite: 'lax', path: '/', maxAge: SESSION_TTL_SECONDS, secure };
}

/** Creates a session and returns the raw token, which only the cookie ever holds. */
export async function createSession(
  db: Database,
  userId: string,
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000);
  await db.insert(sessions).values({ id: hashSessionToken(token), userId, expiresAt });
  return { token, expiresAt };
}

/** The session's user, or null if the token is unknown or expired (an expired row is deleted). */
export async function findSessionUser(db: Database, token: string): Promise<SessionUser | null> {
  if (!TOKEN_PATTERN.test(token)) return null;
  const id = hashSessionToken(token);

  const [row] = await db
    .select({
      expiresAt: sessions.expiresAt,
      user: {
        id: users.id,
        email: users.email,
        displayName: users.displayName,
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
    return null;
  }
  return row.user;
}

export async function deleteSession(db: Database, token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, hashSessionToken(token)));
}
