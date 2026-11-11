import { describe, expect, it } from 'vitest';
import { ListNotificationsQuerySchema, NotificationSchema } from './notifications.js';
import { UserEventSchemas } from './realtime.js';

const notification = {
  id: '01a17e5e-aa56-7985-be46-bf5f1c7e7f01',
  type: 'thread_reply',
  createdAt: '2026-11-12T10:00:00.000Z',
  readAt: null,
  actor: { id: '01a17e5e-aa56-7985-be46-bf5f1c7e7f02', displayName: 'Asha' },
  review: { workspaceId: '01a17e5e-aa56-7985-be46-bf5f1c7e7f03', number: 7, title: 'Fix' },
  threadId: '01a17e5e-aa56-7985-be46-bf5f1c7e7f04',
};

describe('NotificationSchema', () => {
  it('accepts a notification, also without actor or thread', () => {
    expect(NotificationSchema.safeParse(notification).success).toBe(true);
    expect(
      NotificationSchema.safeParse({ ...notification, actor: null, threadId: null }).success,
    ).toBe(true);
    expect(UserEventSchemas['notification:new']).toBe(NotificationSchema);
  });

  it.each([
    ['an unknown type', { ...notification, type: 'mentioned' }],
    ['a bad timestamp', { ...notification, readAt: 'yesterday' }],
    [
      'a review without a number',
      { ...notification, review: { ...notification.review, number: 0 } },
    ],
  ])('rejects %s', (_, payload) => {
    expect(NotificationSchema.safeParse(payload).success).toBe(false);
  });
});

describe('ListNotificationsQuerySchema', () => {
  it('coerces the limit and caps it at 50', () => {
    expect(ListNotificationsQuerySchema.parse({})).toEqual({ limit: 20 });
    expect(ListNotificationsQuerySchema.parse({ limit: '5' }).limit).toBe(5);
    expect(ListNotificationsQuerySchema.safeParse({ limit: '51' }).success).toBe(false);
  });
});
