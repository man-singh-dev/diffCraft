import type { Notification } from '@diffcraft/shared';

export const NOTIFICATION_WORKSPACE = '01a17e5e-aa56-7985-be46-bf5f1c7e7f03';

export function notification(overrides: Partial<Notification> = {}): Notification {
  return {
    id: '01a17e5e-aa56-7985-be46-bf5f1c7e7f01',
    type: 'thread_reply',
    createdAt: '2026-11-12T10:00:00.000Z',
    readAt: null,
    actor: { id: '01a17e5e-aa56-7985-be46-bf5f1c7e7f02', displayName: 'Ravi' },
    review: { workspaceId: NOTIFICATION_WORKSPACE, number: 3, title: 'Use env port' },
    threadId: null,
    ...overrides,
  };
}
