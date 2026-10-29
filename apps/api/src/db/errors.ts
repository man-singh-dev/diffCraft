const UNIQUE_VIOLATION = '23505';

/** True for a Postgres unique violation on `constraint`; Drizzle wraps the pg error in `cause`. */
export function isUniqueViolation(error: unknown, constraint: string): boolean {
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
