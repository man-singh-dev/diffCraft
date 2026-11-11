import { z } from 'zod';
import { ThreadSchema } from './comments.ts';

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

const ReviewRoomEventBaseSchema = z.object({
  reviewId: z.uuid(),
  actorId: z.uuid().nullable(),
  at: z.iso.datetime(),
});

export const ThreadUpsertEventSchema = ReviewRoomEventBaseSchema.extend({ thread: ThreadSchema });
export type ThreadUpsertEvent = z.infer<typeof ThreadUpsertEventSchema>;

export const REVIEW_CHANGE_REASONS = [
  'reviewers',
  'decision',
  'status',
  'merged',
  'updated',
] as const;
export const ReviewChangeReasonSchema = z.enum(REVIEW_CHANGE_REASONS);
export type ReviewChangeReason = z.infer<typeof ReviewChangeReasonSchema>;

export const ReviewChangedEventSchema = ReviewRoomEventBaseSchema.extend({
  reason: ReviewChangeReasonSchema,
});
export type ReviewChangedEvent = z.infer<typeof ReviewChangedEventSchema>;

export const ReviewDeletedEventSchema = ReviewRoomEventBaseSchema;
export type ReviewDeletedEvent = z.infer<typeof ReviewDeletedEventSchema>;

export const ReviewRoomEventSchemas = {
  'thread:upsert': ThreadUpsertEventSchema,
  'review:changed': ReviewChangedEventSchema,
  'review:deleted': ReviewDeletedEventSchema,
} as const;

export type ReviewRoomEvents = {
  [E in keyof typeof ReviewRoomEventSchemas]: z.infer<(typeof ReviewRoomEventSchemas)[E]>;
};

export type ServerToClientEvents = {
  [E in keyof ReviewRoomEvents]: (payload: ReviewRoomEvents[E]) => void;
};

export const reviewRoom = (reviewId: string) => `review:${reviewId}`;
