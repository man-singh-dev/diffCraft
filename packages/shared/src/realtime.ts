import { z } from 'zod';
import { AiJobSchema } from './ai.ts';
import { ThreadSchema } from './comments.ts';
import { NotificationSchema } from './notifications.ts';

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

export const AnalysisStatusEventSchema = ReviewRoomEventBaseSchema.extend({ job: AiJobSchema });
export type AnalysisStatusEvent = z.infer<typeof AnalysisStatusEventSchema>;

export const AnalysisCompletedEventSchema = ReviewRoomEventBaseSchema.extend({
  jobId: z.uuid(),
  findings: z.number().int().min(0),
});
export type AnalysisCompletedEvent = z.infer<typeof AnalysisCompletedEventSchema>;

export const PRESENCE_MAX_VIEWERS = 50;

export const PresenceViewerSchema = z.object({ id: z.uuid(), displayName: z.string() });
export type PresenceViewer = z.infer<typeof PresenceViewerSchema>;

export const PresenceEventSchema = z.object({
  reviewId: z.uuid(),
  at: z.iso.datetime(),
  viewers: z.array(PresenceViewerSchema).max(PRESENCE_MAX_VIEWERS),
  total: z.number().int().min(0),
});
export type PresenceEvent = z.infer<typeof PresenceEventSchema>;

export const ACCESS_REVOKED_REASONS = ['removed', 'workspace_deleted'] as const;
export const AccessRevokedReasonSchema = z.enum(ACCESS_REVOKED_REASONS);
export type AccessRevokedReason = z.infer<typeof AccessRevokedReasonSchema>;

export const AccessRevokedEventSchema = z.object({
  reviewId: z.uuid(),
  reason: AccessRevokedReasonSchema,
});
export type AccessRevokedEvent = z.infer<typeof AccessRevokedEventSchema>;

export const ReviewRoomEventSchemas = {
  'thread:upsert': ThreadUpsertEventSchema,
  'review:changed': ReviewChangedEventSchema,
  'review:deleted': ReviewDeletedEventSchema,
  presence: PresenceEventSchema,
  'analysis:status': AnalysisStatusEventSchema,
  'analysis:completed': AnalysisCompletedEventSchema,
  'review:access-revoked': AccessRevokedEventSchema,
} as const;

export type ReviewRoomEvents = {
  [E in keyof typeof ReviewRoomEventSchemas]: z.infer<(typeof ReviewRoomEventSchemas)[E]>;
};

export const UserEventSchemas = {
  'notification:new': NotificationSchema,
} as const;

export type UserEvents = {
  [E in keyof typeof UserEventSchemas]: z.infer<(typeof UserEventSchemas)[E]>;
};

export type ServerToClientEvents = {
  [E in keyof ReviewRoomEvents]: (payload: ReviewRoomEvents[E]) => void;
} & {
  [E in keyof UserEvents]: (payload: UserEvents[E]) => void;
};

export const reviewRoom = (reviewId: string) => `review:${reviewId}`;
export const userRoom = (userId: string) => `user:${userId}`;
