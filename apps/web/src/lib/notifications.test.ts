import type { NotificationType } from '@diffcraft/shared';
import { describe, expect, it } from 'vitest';
import {
  badgeText,
  bellLabel,
  lineThreadHref,
  notificationHref,
  notificationText,
} from './notifications';
import { notification, NOTIFICATION_WORKSPACE as WS } from './notification-fixture';

const THREAD = '01a17e5e-aa56-7985-be46-bf5f1c7e7f04';
const FILE = '01a17e5e-aa56-7985-be46-bf5f1c7e7f05';

describe('badgeText', () => {
  it.each([
    [0, null],
    [-1, null],
    [1, '1'],
    [9, '9'],
    [10, '9+'],
    [250, '9+'],
  ])('%i → %s', (count, text) => {
    expect(badgeText(count)).toBe(text);
  });
});

describe('bellLabel', () => {
  it('includes the unread count when there is one', () => {
    expect(bellLabel(0)).toBe('Notifications');
    expect(bellLabel(12)).toBe('Notifications, 12 unread');
  });
});

describe('notificationText', () => {
  it.each<[NotificationType, string]>([
    ['thread_created', 'Ravi commented on #3 Use env port'],
    ['thread_reply', 'Ravi replied on #3 Use env port'],
    ['reviewer_assigned', 'Ravi asked you to review #3 Use env port'],
    ['changes_requested', 'Ravi requested changes on #3 Use env port'],
    ['review_approved', 'Ravi approved #3 Use env port'],
    ['review_merged', 'Ravi merged #3 Use env port'],
    ['review_closed', 'Ravi closed #3 Use env port'],
  ])('%s', (type, text) => {
    expect(notificationText(notification({ type }))).toBe(text);
  });

  it('says "Someone" once the actor account is gone', () => {
    expect(notificationText(notification({ type: 'review_approved', actor: null }))).toBe(
      'Someone approved #3 Use env port',
    );
  });
});

describe('notificationHref', () => {
  it('links to the review, and to the thread when there is one', () => {
    expect(notificationHref(notification())).toBe(`/workspaces/${WS}/reviews/3`);
    expect(notificationHref(notification({ threadId: THREAD }))).toBe(
      `/workspaces/${WS}/reviews/3#thread-${THREAD}`,
    );
  });
});

describe('lineThreadHref', () => {
  const files = `/workspaces/${WS}/reviews/3/files`;
  const anchor = { fileId: FILE, side: 'new' as const, line: 12, lineContent: 'x' };

  it('sends a line thread to its line on the files page', () => {
    expect(lineThreadHref(`#thread-${THREAD}`, [{ id: THREAD, anchor }], files)).toBe(
      `${files}#f-${FILE}-R12`,
    );
  });

  it('leaves review threads, unknown threads and other hashes alone', () => {
    expect(lineThreadHref(`#thread-${THREAD}`, [{ id: THREAD, anchor: null }], files)).toBeNull();
    expect(lineThreadHref(`#thread-${THREAD}`, [], files)).toBeNull();
    expect(lineThreadHref('#history', [{ id: THREAD, anchor }], files)).toBeNull();
  });
});
