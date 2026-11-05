import type { LoginRequest, PublicUser, RegisterRequest } from '@diffcraft/shared';
import { eq, sql } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import { isUniqueViolation } from '../../db/errors.js';
import { users, type User } from '../../db/schema/index.js';
import { AppError } from '../../errors.js';
import type { Database } from '../../plugins/db.js';
import { hashPassword, verifyPassword } from './password.js';

const EMAIL_UNIQUE_INDEX = 'users_email_lower_unique';

// A real Argon2id hash with hashPassword's parameters, so an unknown email costs as much time as a wrong password.
export const DUMMY_PASSWORD_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$dCwVrvgvbQ6iNxGUk5S1Eg$ZmwZkZyWyT/jasOucwMZzLoJVEb5OGR7C7TTRvamQS0';

export class EmailTakenError extends AppError {
  constructor() {
    super(409, 'email_taken', 'An account with this email already exists.');
  }
}

export class InvalidCredentialsError extends AppError {
  constructor() {
    super(401, 'invalid_credentials', 'Invalid email or password');
  }
}

export async function registerUser(db: Database, input: RegisterRequest): Promise<PublicUser> {
  const passwordHash = await hashPassword(input.password);

  let rows: User[];
  try {
    rows = await db
      .insert(users)
      .values({ email: input.email, displayName: input.displayName, passwordHash })
      .returning();
  } catch (error) {
    if (isUniqueViolation(error, EMAIL_UNIQUE_INDEX)) throw new EmailTakenError();
    throw error;
  }

  const [user] = rows;
  if (!user) throw new Error('INSERT ... RETURNING returned no row');
  return toPublicUser(user);
}

export async function verifyCredentials(
  db: Database,
  input: LoginRequest,
  log: FastifyBaseLogger,
): Promise<User> {
  // Matches the lower(email) unique index; input.email is already lowercased.
  const [user] = await db
    .select()
    .from(users)
    .where(eq(sql`lower(${users.email})`, input.email));

  // Always run Argon2, even with no user, so response time doesn't reveal whether the email exists.
  let passwordMatches = false;
  try {
    passwordMatches = await verifyPassword(
      user?.passwordHash ?? DUMMY_PASSWORD_HASH,
      input.password,
    );
  } catch (err) {
    // An unparseable stored hash fails like a wrong password (no login, no different answer), but leaves a trace.
    log.error({ err, userId: user?.id }, 'password verification failed');
  }
  if (!user || !passwordMatches) throw new InvalidCredentialsError();
  return user;
}

export function toPublicUser(
  user: Pick<User, 'id' | 'email' | 'displayName' | 'createdAt'>,
): PublicUser {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    createdAt: user.createdAt.toISOString(),
  };
}
