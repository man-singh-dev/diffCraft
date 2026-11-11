import {
  lineAnchor,
  type Notification,
  type NotificationType,
  type Thread,
} from '@diffcraft/shared';

export function badgeText(unread: number): string | null {
  if (unread <= 0) return null;
  return unread > 9 ? '9+' : String(unread);
}

export function bellLabel(unread: number): string {
  return unread > 0 ? `Notifications, ${unread} unread` : 'Notifications';
}

const ACTIONS: Record<NotificationType, string> = {
  thread_created: 'commented on',
  thread_reply: 'replied on',
  reviewer_assigned: 'asked you to review',
  changes_requested: 'requested changes on',
  review_approved: 'approved',
  review_merged: 'merged',
  review_closed: 'closed',
};

export function notificationText({ type, actor, review }: Notification): string {
  return `${actor?.displayName ?? 'Someone'} ${ACTIONS[type]} #${review.number} ${review.title}`;
}

export const threadHash = (threadId: string) => `#thread-${threadId}`;

export function notificationHref({ review, threadId }: Notification): string {
  const path = `/workspaces/${encodeURIComponent(review.workspaceId)}/reviews/${review.number}`;
  return threadId ? `${path}${threadHash(threadId)}` : path;
}

// Line threads are shown on the files page, under their line: send a #thread-… link there.
export function lineThreadHref(
  hash: string,
  threads: Pick<Thread, 'id' | 'anchor'>[],
  filesHref: string,
): string | null {
  if (!hash.startsWith('#thread-')) return null;
  const anchor = threads.find((t) => t.id === hash.slice('#thread-'.length))?.anchor;
  return anchor ? `${filesHref}#${lineAnchor(anchor.fileId, anchor.side, anchor.line)}` : null;
}
