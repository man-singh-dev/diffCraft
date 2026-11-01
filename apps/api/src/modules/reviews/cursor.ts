import { z } from 'zod';
import { UUID_PATTERN } from '../workspaces/require-workspace-role.js';

/**
 * Position after the last item of a page: its created_at and id. `createdAt` is the database
 * value with all six fractional digits, in UTC. It must never go through a JS Date, which keeps
 * only milliseconds: rows created in the same millisecond would then be skipped or repeated.
 */
export interface ReviewCursor {
  createdAt: string;
  id: string;
}

/** The format the list query produces with to_char(... 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'). */
const TIMESTAMP_PATTERN = /^[1-9]\d{3}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]{1,200}$/;

const CursorSchema = z
  .object({
    createdAt: z
      .string()
      .regex(TIMESTAMP_PATTERN)
      // A real calendar date and time (no month 13 or February 30), so Postgres can't reject it.
      .refine((value) => {
        const date = new Date(`${value.slice(0, 23)}Z`);
        return !Number.isNaN(date.getTime()) && date.toISOString() === `${value.slice(0, 23)}Z`;
      }),
    id: z.string().regex(UUID_PATTERN),
  })
  .strict();

export function encodeCursor(cursor: ReviewCursor): string {
  return Buffer.from(JSON.stringify({ createdAt: cursor.createdAt, id: cursor.id })).toString(
    'base64url',
  );
}

/** The cursor, or null if `value` is not one this API produced. */
export function decodeCursor(value: string): ReviewCursor | null {
  // Buffer's decoder silently skips characters outside the alphabet, so check them first.
  if (!BASE64URL_PATTERN.test(value)) return null;
  let json: unknown;
  try {
    json = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  const parsed = CursorSchema.safeParse(json);
  return parsed.success ? parsed.data : null;
}
