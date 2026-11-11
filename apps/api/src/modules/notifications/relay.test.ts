import { NotificationSchema, type Notification } from '@diffcraft/shared';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { notifications, outboxEvents, workspaceMembers } from '../../db/schema/index.js';
import type { Database } from '../../plugins/db.js';
import {
  addMember,
  createUserWithSession,
  failUpdateInTransaction,
  type TestUser,
} from '../../test/fixtures.js';
import {
  closeRealtimeResourcesAfterTests,
  connect,
  getTicket,
  nextEvent,
  PATCH,
  receivedWithin,
  startApp,
} from '../../test/realtime.js';
import { describeWithDbAndRedis } from '../../test/redis.js';
import { createThread } from '../comments/service.js';
import { createReview } from '../reviews/service.js';
import { createWorkspace } from '../workspaces/service.js';
import { createRelay, DEFAULT_RELAY_OPTIONS, type RelayDeps, type RelayOptions } from './relay.js';

closeRealtimeResourcesAfterTests();

describeWithDbAndRedis('outbox relay', () => {
  let app: FastifyInstance;
  let url: string;
  let author: TestUser;
  let commenter: TestUser;
  let bystander: TestUser;
  let workspaceId: string;
  let reviewId: string;

  beforeAll(async () => {
    ({ app, url } = await startApp());
    author = await createUserWithSession(app.db);
    commenter = await createUserWithSession(app.db);
    bystander = await createUserWithSession(app.db);
    workspaceId = (await createWorkspace(app.db, author.id, { name: 'Relay' })).id;
    await addMember(app.db, workspaceId, commenter.id, 'member');
    await addMember(app.db, workspaceId, bystander.id, 'member');
    reviewId = (
      await createReview(app.db, {
        workspaceId,
        authorId: author.id,
        input: { title: 'Relayed', description: null, patch: PATCH },
      })
    ).id;
  });

  // Test files share one database and nothing else relays there: start each test from an empty backlog.
  beforeEach(async () => {
    await app.db
      .update(outboxEvents)
      .set({ publishedAt: sql`now()` })
      .where(isNull(outboxEvents.publishedAt));
  });

  function relay(
    emit: RelayDeps['emit'],
    { db = app.db, ...options }: Partial<RelayOptions> & { db?: Database } = {},
  ) {
    return createRelay(
      { db, log: app.log, emit, canDeliver: () => true },
      { ...DEFAULT_RELAY_OPTIONS, ...options },
    );
  }

  const toSockets: RelayDeps['emit'] = (userId, notification) =>
    app.realtime.emitToUser(userId, 'notification:new', notification);

  async function notifyAuthor(): Promise<string> {
    const thread = await createThread(app.db, {
      workspaceId,
      reviewId,
      authorId: commenter.id,
      input: { body: 'hello' },
    });
    const [row] = await app.db
      .select({ id: notifications.id })
      .from(notifications)
      .where(and(eq(notifications.threadId, thread.id), eq(notifications.userId, author.id)));
    return row!.id;
  }

  async function outboxRow(notificationId: string) {
    const [row] = await app.db
      .select()
      .from(outboxEvents)
      .where(sql`${outboxEvents.payload}->>'notificationId' = ${notificationId}`);
    return row!;
  }

  function recorder(ids: string[]) {
    const delivered: string[] = [];
    const emit: RelayDeps['emit'] = (_, notification) => {
      if (ids.includes(notification.id)) delivered.push(notification.id);
    };
    return { delivered, emit };
  }

  const connectAs = async (user: TestUser) => connect(url, { ticket: await getTicket(app, user) });

  it('delivers to every socket of the recipient, to no one else, and marks the row published', async () => {
    const tabs = [await connectAs(author), await connectAs(author)];
    const others = [await connectAs(commenter), await connectAs(bystander)];
    const id = await notifyAuthor();

    const received = tabs.map((tab) => nextEvent(tab, 'notification:new'));
    const quiet = Promise.all(others.map((s) => receivedWithin(s, 'notification:new', 500)));
    expect((await relay(toSockets).tick()).delivered).toBeGreaterThanOrEqual(1);

    for (const payload of await Promise.all(received)) {
      const notification = NotificationSchema.parse(payload);
      expect(notification).toMatchObject({
        id,
        type: 'thread_created',
        readAt: null,
        actor: { id: commenter.id },
        review: { workspaceId, title: 'Relayed' },
      });
    }
    expect(await quiet).toEqual([false, false]);
    expect(await outboxRow(id)).toMatchObject({ publishedAt: expect.any(Date), attempts: 0 });
  });

  it('retries a failed emit on the next tick', async () => {
    const id = await notifyAuthor();
    let failures = 1;
    const delivered: Notification[] = [];
    const flaky = relay((_, notification) => {
      if (notification.id !== id) return;
      if (failures-- > 0) throw new Error('emit failed');
      delivered.push(notification);
    });

    await flaky.tick();
    expect(await outboxRow(id)).toMatchObject({ publishedAt: null, attempts: 1 });
    await flaky.tick();
    expect(delivered.map((n) => n.id)).toEqual([id]);
    expect(await outboxRow(id)).toMatchObject({ publishedAt: expect.any(Date), attempts: 1 });
  });

  it('gives up after 10 attempts', async () => {
    const id = await notifyAuthor();
    await app.db
      .update(outboxEvents)
      .set({ attempts: 9 })
      .where(eq(outboxEvents.id, (await outboxRow(id)).id));

    const result = await relay((_, notification) => {
      if (notification.id === id) throw new Error('emit failed');
    }).tick();
    expect(result.gaveUp).toBe(1);
    expect(await outboxRow(id)).toMatchObject({ publishedAt: expect.any(Date), attempts: 10 });
  });

  it('two relays at once deliver each row once (SKIP LOCKED)', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) ids.push(await notifyAuthor());

    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let entered!: () => void;
    const holding = new Promise<void>((resolve) => (entered = resolve));
    const first: string[] = [];
    const slow = relay(async (_, notification) => {
      if (!ids.includes(notification.id)) return;
      entered();
      await gate;
      first.push(notification.id);
    });
    const second = recorder(ids);

    const firstTick = slow.tick();
    await holding;
    await relay(second.emit).tick();
    release();
    await firstTick;

    expect(second.delivered).toEqual([]);
    expect(first.sort()).toEqual([...ids].sort());
  });

  it('re-delivers after a crash between the emit and the commit (at least once)', async () => {
    const id = await notifyAuthor();
    const crashed = recorder([id]);
    const crashing = failUpdateInTransaction(app.db, outboxEvents, 'crashed before commit');
    await expect(relay(crashed.emit, { db: crashing }).tick()).rejects.toThrow(
      'crashed before commit',
    );
    expect(crashed.delivered).toEqual([id]);
    expect(await outboxRow(id)).toMatchObject({ publishedAt: null, attempts: 0 });

    const restarted = recorder([id]);
    await relay(restarted.emit).tick();
    expect(restarted.delivered).toEqual([id]);
    expect((await outboxRow(id)).publishedAt).not.toBeNull();
  });

  it('marks a row published without emitting once the recipient has left the workspace', async () => {
    const leaver = await createUserWithSession(app.db);
    await addMember(app.db, workspaceId, leaver.id, 'member');
    const review = await createReview(app.db, {
      workspaceId,
      authorId: leaver.id,
      input: { title: 'Gone', description: null, patch: PATCH },
    });
    await createThread(app.db, {
      workspaceId,
      reviewId: review.id,
      authorId: commenter.id,
      input: { body: 'x' },
    });
    const [row] = await app.db
      .select({ id: notifications.id })
      .from(notifications)
      .where(eq(notifications.reviewId, review.id));
    await app.db
      .delete(workspaceMembers)
      .where(
        and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, leaver.id)),
      );

    const recorded = recorder([row!.id]);
    await relay(recorded.emit).tick();
    expect(recorded.delivered).toEqual([]);
    expect((await outboxRow(row!.id)).publishedAt).not.toBeNull();
  });

  it('deletes rows published more than 7 days ago, in batches', async () => {
    const days = (n: number) => sql`now() - ${n} * interval '1 day'`;
    const inserted = await app.db
      .insert(outboxEvents)
      .values([
        { topic: 'test', payload: {}, publishedAt: days(8) },
        { topic: 'test', payload: {}, publishedAt: days(8) },
        { topic: 'test', payload: {}, publishedAt: days(8) },
        { topic: 'test', payload: {}, publishedAt: days(1) },
        { topic: 'test', payload: {}, createdAt: days(8), publishedAt: sql`now()` },
      ])
      .returning({ id: outboxEvents.id });

    expect(await relay(() => {}, { cleanupBatchSize: 2 }).cleanup()).toBeGreaterThanOrEqual(3);
    const left = await app.db
      .select({ id: outboxEvents.id })
      .from(outboxEvents)
      .where(
        inArray(
          outboxEvents.id,
          inserted.map((row) => row.id),
        ),
      );
    expect(left.map((row) => row.id).sort()).toEqual([inserted[3]!.id, inserted[4]!.id].sort());
  });

  describe('loop', () => {
    it('relays on its own once started, and stops cleanly', async () => {
      const tab = await connectAs(author);
      const loop = relay(toSockets, { intervalMs: 20 });
      loop.start();
      const received = nextEvent(tab, 'notification:new');
      const id = await notifyAuthor();
      expect(NotificationSchema.parse(await received).id).toBe(id);

      await loop.stop();
      const after = await notifyAuthor();
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect((await outboxRow(after)).publishedAt).toBeNull();
    });
  });
});
