import type { NotificationType } from '@diffcraft/shared';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';
import {
  comments,
  commentThreads,
  notifications,
  outboxEvents,
  reviewDecisions,
  reviewReviewers,
  reviews,
  users,
  workspaceMembers,
} from '../../db/schema/index.js';
import type { Database } from '../../plugins/db.js';
import { describeWithDb, testDatabaseUrl } from '../../test/db.js';
import { addMember, createUserWithSession, failInsertInTransaction } from '../../test/fixtures.js';
import { PATCH } from '../../test/realtime.js';
import { assignReviewers, mergeReview, submitDecision } from '../approvals/service.js';
import { addReply, createThread } from '../comments/service.js';
import { createReview, updateReview } from '../reviews/service.js';
import { createWorkspace } from '../workspaces/service.js';

describeWithDb('notifications', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp(
      loadConfig({
        LOG_LEVEL: 'silent',
        RATE_LIMIT_ENABLED: 'false',
        DATABASE_URL: testDatabaseUrl,
      }),
    );
  });

  afterAll(async () => {
    await app.close();
  });

  async function setup() {
    const [owner, a, b, c, viewer] = await Promise.all(
      Array.from({ length: 5 }, () => createUserWithSession(app.db)),
    );
    const workspace = await createWorkspace(app.db, owner!.id, { name: 'Notify' });
    for (const user of [a, b, c]) await addMember(app.db, workspace.id, user!.id, 'member');
    await addMember(app.db, workspace.id, viewer!.id, 'viewer');
    const review = await createReview(app.db, {
      workspaceId: workspace.id,
      authorId: owner!.id,
      input: { title: 'Change', description: null, patch: PATCH },
    });
    const ids = { owner: owner!.id, a: a!.id, b: b!.id, c: c!.id, viewer: viewer!.id };
    const base = { workspaceId: workspace.id, reviewId: review.id };
    return { ids, base, workspaceId: workspace.id, reviewId: review.id };
  }

  type Setup = Awaited<ReturnType<typeof setup>>;

  async function sent(reviewId: string, type: NotificationType, actorId?: string) {
    const rows = await app.db
      .select({ userId: notifications.userId })
      .from(notifications)
      .where(
        and(
          eq(notifications.reviewId, reviewId),
          eq(notifications.type, type),
          actorId ? eq(notifications.actorId, actorId) : undefined,
        ),
      )
      .orderBy(asc(notifications.userId));
    return rows.map((row) => row.userId);
  }

  const sorted = (...ids: string[]) => [...ids].sort();

  const thread = (s: Setup, authorId: string, db: Database = app.db) =>
    createThread(db, { ...s.base, authorId, input: { body: 'secret body' } });

  const reply = (s: Setup, threadId: string, authorId: string, db: Database = app.db) =>
    addReply(db, { ...s.base, threadId, authorId, body: 'secret reply' });

  it('a new thread notifies the review author, never the actor', async () => {
    const s = await setup();
    const t = await thread(s, s.ids.a);
    await thread(s, s.ids.owner);

    const rows = await app.db
      .select()
      .from(notifications)
      .where(eq(notifications.reviewId, s.reviewId));
    expect(rows).toEqual([
      expect.objectContaining({
        userId: s.ids.owner,
        actorId: s.ids.a,
        type: 'thread_created',
        threadId: t.id,
        workspaceId: s.workspaceId,
        readAt: null,
      }),
    ]);
  });

  it('a reply notifies the thread author, earlier writers and the review author, once each', async () => {
    const s = await setup();
    const t = await thread(s, s.ids.a);

    await reply(s, t.id, s.ids.b);
    expect(await sent(s.reviewId, 'thread_reply', s.ids.b)).toEqual(sorted(s.ids.a, s.ids.owner));

    await reply(s, t.id, s.ids.c);
    expect(await sent(s.reviewId, 'thread_reply', s.ids.c)).toEqual(
      sorted(s.ids.a, s.ids.b, s.ids.owner),
    );

    await reply(s, t.id, s.ids.owner);
    await reply(s, t.id, s.ids.owner);
    expect(await sent(s.reviewId, 'thread_reply', s.ids.owner)).toEqual(
      sorted(s.ids.a, s.ids.b, s.ids.c, s.ids.a, s.ids.b, s.ids.c),
    );

    await reply(s, t.id, s.ids.a);
    expect(await sent(s.reviewId, 'thread_reply', s.ids.a)).toEqual(
      sorted(s.ids.b, s.ids.c, s.ids.owner),
    );
  });

  it('a reply skips former members and deleted users', async () => {
    const s = await setup();
    const leaver = await createUserWithSession(app.db);
    const doomed = await createUserWithSession(app.db);
    await addMember(app.db, s.workspaceId, leaver.id, 'member');
    await addMember(app.db, s.workspaceId, doomed.id, 'member');
    const t = await thread(s, s.ids.a);
    await reply(s, t.id, leaver.id);
    await reply(s, t.id, doomed.id);
    await app.db
      .delete(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, s.workspaceId),
          eq(workspaceMembers.userId, leaver.id),
        ),
      );
    await app.db.delete(users).where(eq(users.id, doomed.id));

    await reply(s, t.id, s.ids.b);
    expect(await sent(s.reviewId, 'thread_reply', s.ids.b)).toEqual(sorted(s.ids.a, s.ids.owner));
  });

  it('assigning notifies each new assignee once, but not an actor assigning themselves', async () => {
    const s = await setup();
    await assignReviewers(app.db, { ...s.base, actorId: s.ids.a, userIds: [s.ids.a, s.ids.b] });
    await assignReviewers(app.db, { ...s.base, actorId: s.ids.owner, userIds: [s.ids.b] });
    expect(await sent(s.reviewId, 'reviewer_assigned')).toEqual([s.ids.b]);
  });

  it('decisions notify the review author', async () => {
    const s = await setup();
    await assignReviewers(app.db, { ...s.base, actorId: s.ids.owner, userIds: [s.ids.a, s.ids.b] });
    await submitDecision(app.db, { ...s.base, reviewerId: s.ids.a, decision: 'approve' });
    await submitDecision(app.db, { ...s.base, reviewerId: s.ids.b, decision: 'request_changes' });
    expect(await sent(s.reviewId, 'review_approved', s.ids.a)).toEqual([s.ids.owner]);
    expect(await sent(s.reviewId, 'changes_requested', s.ids.b)).toEqual([s.ids.owner]);
  });

  it('a merge notifies the author and the reviewers who are still members', async () => {
    const s = await setup();
    await assignReviewers(app.db, {
      ...s.base,
      actorId: s.ids.owner,
      userIds: [s.ids.a, s.ids.b, s.ids.c],
    });
    await submitDecision(app.db, { ...s.base, reviewerId: s.ids.a, decision: 'approve' });
    await app.db
      .delete(workspaceMembers)
      .where(
        and(eq(workspaceMembers.workspaceId, s.workspaceId), eq(workspaceMembers.userId, s.ids.b)),
      );

    await mergeReview(app.db, { ...s.base, actorId: s.ids.c });
    expect(await sent(s.reviewId, 'review_merged')).toEqual(sorted(s.ids.owner, s.ids.a));
  });

  it('closing notifies the author and reviewers except the actor; reopening notifies no one', async () => {
    const s = await setup();
    await assignReviewers(app.db, { ...s.base, actorId: s.ids.owner, userIds: [s.ids.a, s.ids.b] });
    const before = await app.db.$count(notifications, eq(notifications.reviewId, s.reviewId));

    await updateReview(app.db, { ...s.base, actorId: s.ids.a, changes: { status: 'closed' } });
    expect(await sent(s.reviewId, 'review_closed')).toEqual(sorted(s.ids.owner, s.ids.b));

    await updateReview(app.db, { ...s.base, actorId: s.ids.a, changes: { status: 'open' } });
    await updateReview(app.db, { ...s.base, actorId: s.ids.a, changes: { title: 'Renamed' } });
    expect(await app.db.$count(notifications, eq(notifications.reviewId, s.reviewId))).toBe(
      before + 2,
    );
  });

  it('writes one outbox row per notification, holding only ids', async () => {
    const s = await setup();
    const t = await thread(s, s.ids.a);
    await reply(s, t.id, s.ids.b);
    const created = await app.db
      .select({ id: notifications.id, userId: notifications.userId })
      .from(notifications)
      .where(eq(notifications.reviewId, s.reviewId));
    expect(created).toHaveLength(3);

    const rows = await app.db
      .select()
      .from(outboxEvents)
      .where(
        inArray(
          sql`${outboxEvents.payload}->>'notificationId'`,
          created.map((n) => n.id),
        ),
      );
    expect(rows.map((row) => ({ topic: row.topic, payload: row.payload }))).toEqual(
      expect.arrayContaining(
        created.map(({ id, userId }) => ({
          topic: 'notification',
          payload: { userId, notificationId: id },
        })),
      ),
    );
    expect(rows).toHaveLength(3);
    expect(JSON.stringify(rows)).not.toContain('secret');
  });

  it.each<
    [string, (s: Setup, failing: Database) => Promise<unknown>, (s: Setup) => Promise<unknown>]
  >([
    [
      'creating a thread',
      (s, db) => thread(s, s.ids.a, db),
      (s) => app.db.$count(commentThreads, eq(commentThreads.reviewId, s.reviewId)),
    ],
    [
      'replying',
      async (s, db) => {
        const [t] = await app.db
          .select({ id: commentThreads.id })
          .from(commentThreads)
          .where(eq(commentThreads.reviewId, s.reviewId));
        return reply(s, t!.id, s.ids.b, db);
      },
      (s) =>
        app.db
          .select({ id: comments.id })
          .from(comments)
          .innerJoin(commentThreads, eq(commentThreads.id, comments.threadId))
          .where(eq(commentThreads.reviewId, s.reviewId))
          .then((rows) => rows.length),
    ],
    [
      'assigning a reviewer',
      (s, db) => assignReviewers(db, { ...s.base, actorId: s.ids.owner, userIds: [s.ids.c] }),
      (s) => app.db.$count(reviewReviewers, eq(reviewReviewers.reviewId, s.reviewId)),
    ],
    [
      'deciding',
      (s, db) => submitDecision(db, { ...s.base, reviewerId: s.ids.a, decision: 'approve' }),
      (s) => app.db.$count(reviewDecisions, eq(reviewDecisions.reviewId, s.reviewId)),
    ],
    [
      'closing',
      (s, db) => updateReview(db, { ...s.base, actorId: s.ids.a, changes: { status: 'closed' } }),
      (s) =>
        app.db.select({ status: reviews.status }).from(reviews).where(eq(reviews.id, s.reviewId)),
    ],
  ])('%s leaves nothing behind when the outbox insert fails', async (_, action, observe) => {
    const s = await setup();
    await thread(s, s.ids.owner);
    await assignReviewers(app.db, { ...s.base, actorId: s.ids.owner, userIds: [s.ids.a] });
    await app.db.delete(notifications).where(eq(notifications.reviewId, s.reviewId));
    const before = await observe(s);

    const failing = failInsertInTransaction(app.db, outboxEvents, 'outbox insert failed');
    await expect(action(s, failing)).rejects.toThrow('outbox insert failed');

    expect(await observe(s)).toEqual(before);
    expect(await app.db.$count(notifications, eq(notifications.reviewId, s.reviewId))).toBe(0);
  });

  it('a merge leaves nothing behind when the outbox insert fails', async () => {
    const s = await setup();
    await assignReviewers(app.db, { ...s.base, actorId: s.ids.owner, userIds: [s.ids.a] });
    await submitDecision(app.db, { ...s.base, reviewerId: s.ids.a, decision: 'approve' });
    await app.db.delete(notifications).where(eq(notifications.reviewId, s.reviewId));

    const failing = failInsertInTransaction(app.db, outboxEvents, 'outbox insert failed');
    await expect(mergeReview(failing, { ...s.base, actorId: s.ids.b })).rejects.toThrow(
      'outbox insert failed',
    );
    const [review] = await app.db
      .select({ status: reviews.status })
      .from(reviews)
      .where(eq(reviews.id, s.reviewId));
    expect(review?.status).toBe('open');
    expect(await app.db.$count(notifications, eq(notifications.reviewId, s.reviewId))).toBe(0);
  });
});
