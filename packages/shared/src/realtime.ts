import { z } from 'zod';

export const REALTIME_PATH = '/socket.io';

export const RealtimeTicketResponseSchema = z.object({
  ticket: z.string(),
  expiresInSeconds: z.number().int().positive(),
});
export type RealtimeTicketResponse = z.infer<typeof RealtimeTicketResponseSchema>;

export const ReviewJoinRequestSchema = z.object({
  workspaceId: z.uuid(),
  reviewNumber: z.number().int().min(1).max(2_147_483_647),
});
export type ReviewJoinRequest = z.infer<typeof ReviewJoinRequestSchema>;

export const ReviewLeaveRequestSchema = z.object({ reviewId: z.uuid() });
export type ReviewLeaveRequest = z.infer<typeof ReviewLeaveRequestSchema>;

export type ReviewJoinError =
  'invalid_request' | 'not_found' | 'rate_limited' | 'too_many_rooms' | 'internal_error';
export type ReviewJoinAck = { ok: true; reviewId: string } | { ok: false; error: ReviewJoinError };
export type ReviewLeaveAck = { ok: true } | { ok: false; error: 'invalid_request' };

export interface ClientToServerEvents {
  'review:join': (request: ReviewJoinRequest, ack: (response: ReviewJoinAck) => void) => void;
  'review:leave': (request: ReviewLeaveRequest, ack: (response: ReviewLeaveAck) => void) => void;
}

// Events the server emits to a review room; step 2 adds the domain events.
export type ReviewRoomEvents = Record<never, never>;

export type ServerToClientEvents = {
  [E in keyof ReviewRoomEvents]: (payload: ReviewRoomEvents[E]) => void;
};

export const reviewRoom = (reviewId: string) => `review:${reviewId}`;
