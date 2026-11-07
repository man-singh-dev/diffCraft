import { randomBytes } from 'node:crypto';
import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import { emailVerificationTokens, users } from '../../db/schema/index.js';
import { AppError } from '../../errors.js';
import type { Mailer } from '../../mail/mailer.js';
import type { Database } from '../../plugins/db.js';
import { hashSessionToken } from './session.js';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

export const VERIFICATION_TTL_HOURS = 24;
export const RESEND_INTERVAL_SECONDS = 60;

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export class InvalidTokenError extends AppError {
  constructor() {
    super(400, 'invalid_token', 'This verification link is invalid or has expired.');
  }
}

export class VerificationThrottledError extends AppError {
  constructor(readonly retryAfterSeconds: number) {
    super(
      429,
      'verification_throttled',
      `A verification email was just sent. Try again in ${retryAfterSeconds} seconds.`,
    );
    this.headers = { 'retry-after': String(retryAfterSeconds) };
  }
}

export class VerificationEmailFailedError extends AppError {
  constructor() {
    super(503, 'email_send_failed', "We couldn't send the email. Please try again in a minute.");
  }
}

export async function createVerificationToken(tx: Tx | Database, userId: string): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await tx.insert(emailVerificationTokens).values({
    userId,
    tokenHash: hashSessionToken(token),
    expiresAt: sql`now() + make_interval(hours => ${VERIFICATION_TTL_HOURS})`,
  });
  return token;
}

export async function verifyEmail(db: Database, token: string): Promise<void> {
  if (!TOKEN_PATTERN.test(token)) throw new InvalidTokenError();
  const verified = await db.transaction(async (tx) => {
    // One conditional UPDATE: of two requests with the same token, the second waits on the row lock, then matches nothing.
    const [used] = await tx
      .update(emailVerificationTokens)
      .set({ usedAt: sql`now()` })
      .where(
        and(
          eq(emailVerificationTokens.tokenHash, hashSessionToken(token)),
          isNull(emailVerificationTokens.usedAt),
          gt(emailVerificationTokens.expiresAt, sql`now()`),
        ),
      )
      .returning({ userId: emailVerificationTokens.userId });
    if (!used) return false;

    await tx
      .update(users)
      .set({ emailVerifiedAt: sql`now()` })
      .where(and(eq(users.id, used.userId), isNull(users.emailVerifiedAt)));
    return true;
  });
  if (!verified) throw new InvalidTokenError();
}

export async function startResend(
  db: Database,
  userId: string,
): Promise<{ alreadyVerified: true } | { alreadyVerified: false; email: string; token: string }> {
  return db.transaction(async (tx) => {
    // The user row lock makes the 60 s check and the insert one step for concurrent resends.
    const [user] = await tx
      .select({ email: users.email, emailVerifiedAt: users.emailVerifiedAt })
      .from(users)
      .where(eq(users.id, userId))
      .for('update');
    if (!user) throw new Error('session user not found');
    if (user.emailVerifiedAt) return { alreadyVerified: true };

    const [latest] = await tx
      .select({
        waitSeconds: sql<number>`ceil(extract(epoch from (${emailVerificationTokens.createdAt} + make_interval(secs => ${RESEND_INTERVAL_SECONDS}) - now())))::int`,
      })
      .from(emailVerificationTokens)
      .where(eq(emailVerificationTokens.userId, userId))
      .orderBy(desc(emailVerificationTokens.createdAt))
      .limit(1);
    if (latest && latest.waitSeconds > 0) throw new VerificationThrottledError(latest.waitSeconds);

    return {
      alreadyVerified: false,
      email: user.email,
      token: await createVerificationToken(tx, userId),
    };
  });
}

export function verificationLink(webOrigin: string, token: string): string {
  const url = new URL('/verify-email', webOrigin);
  url.searchParams.set('token', token);
  return url.toString();
}

export async function sendVerificationEmail(
  mailer: Mailer,
  log: FastifyBaseLogger,
  {
    webOrigin,
    userId,
    email,
    token,
  }: { webOrigin: string; userId: string; email: string; token: string },
): Promise<boolean> {
  const link = verificationLink(webOrigin, token);
  try {
    await mailer.send({
      to: email,
      subject: 'Verify your DiffCraft email address',
      text: `Welcome to DiffCraft!\n\nConfirm your email address by opening this link:\n\n${link}\n\nThe link expires in ${VERIFICATION_TTL_HOURS} hours. If you didn't sign up, ignore this email.\n`,
    });
    return true;
  } catch (error) {
    // Only safe fields: a transport error could echo the message, and the message holds the token.
    const { name, message } =
      error instanceof Error ? error : { name: 'Error', message: String(error) };
    const code = (error as { code?: unknown } | null)?.code;
    log.error(
      {
        userId,
        err: {
          name,
          message: message.replaceAll(token, '[redacted]'),
          ...(typeof code === 'string' && { code }),
        },
      },
      'verification email failed',
    );
    return false;
  }
}
