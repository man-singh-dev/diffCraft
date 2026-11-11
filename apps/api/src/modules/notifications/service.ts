import type { Notification, NotificationType } from '@diffcraft/shared';
import { and, count, desc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import {
  comments,
  commentThreads,
  notifications,
  outboxEvents,
  reviewReviewers,
  reviews,
  users,
  workspaceMembers,
} from '../../db/schema/index.js';
import type { Database } from '../../plugins/db.js';
import { encodeCursor, type ReviewCursor } from '../reviews/cursor.js';
import type { Tx } from '../reviews/service.js';

type Executor = Database | Tx;

export const NOTIFICATION_TOPIC = 'notification';

export interface NotifyInput {
  workspaceId: string;
  reviewId: string;
  threadId?: string | null;
  actorId: string;
  type: NotificationType;
  recipients: readonly (string | null)[];
}

// Must run in the action's transaction: the notification, its outbox row and the action commit or roll back together.
export async function notify(tx: Tx, input: NotifyInput): Promise<string[]> {
  const candidates = [
    ...new Set(input.recipients.filter((id): id is string => id !== null && id !== input.actorId)),
  ];
  if (candidates.length === 0) return [];

  const members = await tx
    .select({ userId: workspaceMembers.userId })
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, input.workspaceId),
        inArray(workspaceMembers.userId, candidates),
      ),
    );
  if (members.length === 0) return [];

  const created = await tx
    .insert(notifications)
    .values(
      members.map(({ userId }) => ({
        userId,
        workspaceId: input.workspaceId,
        reviewId: input.reviewId,
        threadId: input.threadId ?? null,
        actorId: input.actorId,
        type: input.type,
      })),
    )
    .returning({ id: notifications.id, userId: notifications.userId });

  await tx.insert(outboxEvents).values(
    created.map(({ id, userId }) => ({
      topic: NOTIFICATION_TOPIC,
      payload: { userId, notificationId: id },
    })),
  );
  return created.map(({ id }) => id);
}

export async function reviewAuthor(tx: Tx, reviewId: string): Promise<string | null> {
  const [row] = await tx
    .select({ authorId: reviews.authorId })
    .from(reviews)
    .where(eq(reviews.id, reviewId));
  return row?.authorId ?? null;
}

export async function authorAndReviewers(tx: Tx, reviewId: string): Promise<(string | null)[]> {
  const reviewers = await tx
    .select({ userId: reviewReviewers.userId })
    .from(reviewReviewers)
    .where(eq(reviewReviewers.reviewId, reviewId));
  return [await reviewAuthor(tx, reviewId), ...reviewers.map((r) => r.userId)];
}

export async function threadParticipants(
  tx: Tx,
  reviewId: string,
  threadId: string,
): Promise<(string | null)[]> {
  const [thread] = await tx
    .select({ createdBy: commentThreads.createdBy })
    .from(commentThreads)
    .where(eq(commentThreads.id, threadId));
  const writers = await tx
    .selectDistinct({ authorId: comments.authorId })
    .from(comments)
    .where(eq(comments.threadId, threadId));
  return [
    thread?.createdBy ?? null,
    ...writers.map((w) => w.authorId),
    await reviewAuthor(tx, reviewId),
  ];
}

// Hidden once the user has left the workspace: a former member must not keep reading its review titles.
const recipientIsMember = sql`exists (select 1 from ${workspaceMembers} where ${workspaceMembers.workspaceId} = ${notifications.workspaceId} and ${workspaceMembers.userId} = ${notifications.userId})`;

const visibleTo = (userId: string) => and(eq(notifications.userId, userId), recipientIsMember);

function selectNotifications(db: Executor, where: SQL | undefined) {
  return db
    .select({
      id: notifications.id,
      userId: notifications.userId,
      type: notifications.type,
      createdAt: notifications.createdAt,
      readAt: notifications.readAt,
      threadId: notifications.threadId,
      actorId: users.id,
      actorName: users.displayName,
      workspaceId: reviews.workspaceId,
      number: reviews.number,
      title: reviews.title,
      // Microseconds, as text: the cursor must not lose precision in a JS Date.
      cursorCreatedAt: sql<string>`to_char(${notifications.createdAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
    })
    .from(notifications)
    .innerJoin(reviews, eq(reviews.id, notifications.reviewId))
    .leftJoin(users, eq(users.id, notifications.actorId))
    .where(where);
}

type NotificationResult = Awaited<ReturnType<typeof selectNotifications>>[number];

function toNotification(row: NotificationResult): Notification {
  return {
    id: row.id,
    type: row.type,
    createdAt: row.createdAt.toISOString(),
    readAt: row.readAt?.toISOString() ?? null,
    actor:
      row.actorId !== null && row.actorName !== null
        ? { id: row.actorId, displayName: row.actorName }
        : null,
    review: { workspaceId: row.workspaceId, number: row.number, title: row.title },
    threadId: row.threadId,
  };
}

export async function listNotifications(
  db: Database,
  userId: string,
  { limit, cursor }: { limit: number; cursor?: ReviewCursor | undefined },
): Promise<{ items: Notification[]; nextCursor: string | null }> {
  const rows = await selectNotifications(
    db,
    and(
      visibleTo(userId),
      cursor !== undefined
        ? sql`(${notifications.createdAt}, ${notifications.id}) < (${cursor.createdAt}::timestamptz, ${cursor.id}::uuid)`
        : undefined,
    ),
  )
    .orderBy(desc(notifications.createdAt), desc(notifications.id))
    .limit(limit + 1);

  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    items: page.map(toNotification),
    nextCursor:
      rows.length > limit && last
        ? encodeCursor({ createdAt: last.cursorCreatedAt, id: last.id })
        : null,
  };
}

export async function loadForDelivery(
  db: Executor,
  ids: string[],
): Promise<Map<string, { userId: string; notification: Notification }>> {
  if (ids.length === 0) return new Map();
  const rows = await selectNotifications(
    db,
    and(inArray(notifications.id, ids), recipientIsMember),
  );
  return new Map(
    rows.map((row) => [row.id, { userId: row.userId, notification: toNotification(row) }]),
  );
}

export async function countUnread(db: Database, userId: string): Promise<number> {
  const [row] = await db
    .select({ count: count() })
    .from(notifications)
    .where(and(visibleTo(userId), isNull(notifications.readAt)));
  return row?.count ?? 0;
}

// Idempotent: reading twice keeps the first read time. False when the user can't see it (or it doesn't exist).
export async function markRead(db: Database, userId: string, id: string): Promise<boolean> {
  const rows = await db
    .update(notifications)
    .set({ readAt: sql`coalesce(${notifications.readAt}, now())` })
    .where(and(eq(notifications.id, id), visibleTo(userId)))
    .returning({ id: notifications.id });
  return rows.length > 0;
}

export async function markAllRead(db: Database, userId: string): Promise<number> {
  const result = await db
    .update(notifications)
    .set({ readAt: sql`now()` })
    .where(and(visibleTo(userId), isNull(notifications.readAt)));
  return result.rowCount ?? 0;
}
