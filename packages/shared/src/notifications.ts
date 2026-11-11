import { z } from 'zod';

export const NOTIFICATION_TYPES = [
  'thread_created',
  'thread_reply',
  'reviewer_assigned',
  'changes_requested',
  'review_approved',
  'review_merged',
  'review_closed',
] as const;
export const NotificationTypeSchema = z.enum(NOTIFICATION_TYPES);
export type NotificationType = z.infer<typeof NotificationTypeSchema>;

export const NotificationSchema = z.object({
  id: z.uuid(),
  type: NotificationTypeSchema,
  createdAt: z.iso.datetime(),
  readAt: z.iso.datetime().nullable(),
  actor: z.object({ id: z.uuid(), displayName: z.string() }).nullable(),
  review: z.object({
    workspaceId: z.uuid(),
    number: z.number().int().positive(),
    title: z.string(),
  }),
  threadId: z.uuid().nullable(),
});
export type Notification = z.infer<typeof NotificationSchema>;

export const NOTIFICATION_LIST_MAX_LIMIT = 50;

export const ListNotificationsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(NOTIFICATION_LIST_MAX_LIMIT).default(20),
  cursor: z.string().optional(),
});
export type ListNotificationsQuery = z.infer<typeof ListNotificationsQuerySchema>;

export const NotificationListResponseSchema = z.object({
  items: z.array(NotificationSchema),
  nextCursor: z.string().nullable(),
});
export type NotificationListResponse = z.infer<typeof NotificationListResponseSchema>;

export const UnreadCountResponseSchema = z.object({ count: z.number().int().min(0) });
export type UnreadCountResponse = z.infer<typeof UnreadCountResponseSchema>;
