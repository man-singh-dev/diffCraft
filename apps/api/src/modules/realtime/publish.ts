import type { ReviewChangeReason, ReviewRoomEvents } from '@diffcraft/shared';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Database } from '../../plugins/db.js';
import { getThread } from '../comments/service.js';
import { safeError } from './socket-server.js';

type Executor = Pick<Database, 'execute'>;

export async function databaseTime(db: Executor): Promise<string> {
  // Formatted in SQL because raw execute() returns timestamptz as a driver-formatted string, not a Date.
  const { rows } = await db.execute<{ at: string }>(
    sql`select to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as at`,
  );
  return rows[0]!.at;
}

// Publishing is best effort: the change is already committed, so a failure here must never fail the request.
async function publish(
  app: FastifyInstance,
  event: keyof ReviewRoomEvents,
  reviewId: string,
  run: () => Promise<void>,
): Promise<void> {
  try {
    await run();
  } catch (err) {
    app.log.error({ err: safeError(err), event, reviewId }, 'realtime publish failed');
  }
}

export function publishThread(
  app: FastifyInstance,
  {
    workspaceId,
    reviewId,
    threadId,
    actorId,
  }: { workspaceId: string; reviewId: string; threadId: string; actorId: string | null },
): Promise<void> {
  return publish(app, 'thread:upsert', reviewId, async () => {
    // One snapshot taken at the first statement: the time and the thread agree, so a later `at` never carries older content.
    const loaded = await app.db.transaction(
      async (tx) => {
        const at = await databaseTime(tx);
        const thread = await getThread(tx, workspaceId, reviewId, threadId);
        return thread && { at, thread };
      },
      { isolationLevel: 'repeatable read', accessMode: 'read only' },
    );
    if (!loaded) return;
    app.realtime.emitToReview(reviewId, 'thread:upsert', { reviewId, actorId, ...loaded });
  });
}

export function publishReviewChanged(
  app: FastifyInstance,
  {
    reviewId,
    actorId,
    reason,
  }: { reviewId: string; actorId: string | null; reason: ReviewChangeReason },
): Promise<void> {
  return publish(app, 'review:changed', reviewId, async () => {
    const at = await databaseTime(app.db);
    app.realtime.emitToReview(reviewId, 'review:changed', { reviewId, actorId, at, reason });
  });
}

export function publishReviewDeleted(
  app: FastifyInstance,
  { reviewId, actorId }: { reviewId: string; actorId: string | null },
): Promise<void> {
  return publish(app, 'review:deleted', reviewId, async () => {
    const at = await databaseTime(app.db);
    app.realtime.emitToReview(reviewId, 'review:deleted', { reviewId, actorId, at });
  });
}
