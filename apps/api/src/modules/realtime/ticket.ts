import { randomBytes } from 'node:crypto';
import type { Redis } from 'ioredis';
import { z } from 'zod';
import { hashSessionToken } from '../auth/session.js';

export const TICKET_TTL_SECONDS = 30;

const TICKET_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const TicketClaimsSchema = z.object({
  userId: z.uuid(),
  sessionId: z.string().regex(/^[0-9a-f]{64}$/),
});
export type TicketClaims = z.infer<typeof TicketClaimsSchema>;

// Only the hash is stored: someone reading Redis can't connect as the user.
export const ticketKey = (ticket: string) => `realtime:ticket:${hashSessionToken(ticket)}`;

export async function issueTicket(redis: Redis, claims: TicketClaims): Promise<string> {
  const ticket = randomBytes(32).toString('base64url');
  const stored = await redis.set(
    ticketKey(ticket),
    JSON.stringify({ userId: claims.userId, sessionId: claims.sessionId }),
    'EX',
    TICKET_TTL_SECONDS,
    'NX',
  );
  if (stored !== 'OK') throw new Error('realtime ticket collision');
  return ticket;
}

export async function consumeTicket(redis: Redis, ticket: unknown): Promise<TicketClaims | null> {
  if (typeof ticket !== 'string' || !TICKET_PATTERN.test(ticket)) return null;
  // GETDEL, not GET then DEL: two connections racing with one ticket must not both get the user.
  const value = await redis.getdel(ticketKey(ticket));
  if (value === null) return null;
  try {
    const parsed = TicketClaimsSchema.safeParse(JSON.parse(value));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
