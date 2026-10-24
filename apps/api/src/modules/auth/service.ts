import type { PublicUser, RegisterRequest } from '@diffcraft/shared';
import { users, type User } from '../../db/schema/index.js';
import { AppError } from '../../errors.js';
import type { Database } from '../../plugins/db.js';
import { hashPassword } from './password.js';

const UNIQUE_VIOLATION = '23505';
const EMAIL_UNIQUE_INDEX = 'users_email_lower_unique';

export class EmailTakenError extends AppError {
  constructor() {
    super(409, 'email_taken', 'An account with this email already exists.');
  }
}

/** Creates a user. `input` must already be validated (email trimmed and lowercased). */
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

export function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    createdAt: user.createdAt.toISOString(),
  };
}

/** True for a Postgres unique violation on `constraint`; Drizzle wraps the pg error in `cause`. */
function isUniqueViolation(error: unknown, constraint: string): boolean {
  const pgError = error instanceof Error && error.cause ? error.cause : error;
  return (
    typeof pgError === 'object' &&
    pgError !== null &&
    'code' in pgError &&
    pgError.code === UNIQUE_VIOLATION &&
    'constraint' in pgError &&
    pgError.constraint === constraint
  );
}
