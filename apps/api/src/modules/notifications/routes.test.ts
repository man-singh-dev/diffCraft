import { randomUUID } from 'node:crypto';
import {
  ErrorResponseSchema,
  NotificationListResponseSchema,
  UnreadCountResponseSchema,
  type Notification,
} from '@diffcraft/shared';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';
import { notifications, workspaceMembers } from '../../db/schema/index.js';
import { describeWithDb, testDatabaseUrl } from '../../test/db.js';
import { addMember, createUserWithSession, type TestUser } from '../../test/fixtures.js';
import { PATCH } from '../../test/realtime.js';
import { createReview } from '../reviews/service.js';
import { createWorkspace } from '../workspaces/service.js';
import { listNotifications } from './service.js';

const BASE = '/api/v1/notifications';

describeWithDb('notification routes', () => {
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

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function setup(count: number) {
    const [user, actor] = await Promise.all([1, 2].map(() => createUserWithSession(app.db)));
    const workspace = await createWorkspace(app.db, actor!.id, { name: 'Inbox' });
    await addMember(app.db, workspace.id, user!.id, 'member');
    const review = await createReview(app.db, {
      workspaceId: workspace.id,
      authorId: actor!.id,
      input: { title: 'Inbox review', description: null, patch: PATCH },
    });
    const ids = await insertFor(user!.id, workspace.id, review.id, actor!.id, count);
    return { user: user!, actor: actor!, workspace, review, ids };
  }

  // One statement, so the rows share created_at and only the id breaks the tie.
  async function insertFor(
    userId: string,
    workspaceId: string,
    reviewId: string,
    actorId: string,
    count: number,
  ) {
    if (count === 0) return [];
    const rows = await app.db
      .insert(notifications)
      .values(
        Array.from({ length: count }, () => ({
          userId,
          workspaceId,
          reviewId,
          actorId,
          type: 'review_approved' as const,
        })),
      )
      .returning({ id: notifications.id });
    return rows.map((row) => row.id);
  }

  const get = (user: TestUser, url: string) =>
    app.inject({ method: 'GET', url, cookies: user.cookies });
  const post = (user: TestUser, url: string) =>
    app.inject({ method: 'POST', url, cookies: user.cookies });

  async function unread(user: TestUser) {
    const res = await get(user, `${BASE}/unread-count`);
    expect(res.statusCode).toBe(200);
    return UnreadCountResponseSchema.parse(res.json()).count;
  }

  async function list(user: TestUser, query = '') {
    const res = await get(user, `${BASE}${query}`);
    expect(res.statusCode).toBe(200);
    return NotificationListResponseSchema.parse(res.json());
  }

  it('requires a session', async () => {
    for (const [method, url] of [
      ['GET', BASE],
      ['GET', `${BASE}/unread-count`],
      ['POST', `${BASE}/${randomUUID()}/read`],
      ['POST', `${BASE}/read-all`],
    ] as const) {
      const res = await app.inject({ method, url });
      expect(res.statusCode).toBe(401);
    }
  });

  it('pages newest first with an opaque cursor, without gaps or repeats', async () => {
    const { user, actor, workspace, review, ids } = await setup(25);
    const seen: Notification[] = [];
    let cursor: string | null = null;
    const sizes: number[] = [];
    do {
      const page = await list(user, `?limit=10${cursor ? `&cursor=${cursor}` : ''}`);
      sizes.push(page.items.length);
      seen.push(...page.items);
      cursor = page.nextCursor;
    } while (cursor);

    expect(sizes).toEqual([10, 10, 5]);
    expect(seen.map((n) => n.id)).toEqual([...ids].sort().reverse());
    expect(seen[0]).toEqual({
      id: expect.any(String),
      type: 'review_approved',
      createdAt: expect.any(String),
      readAt: null,
      actor: { id: actor.id, displayName: 'Test' },
      review: { workspaceId: workspace.id, number: review.number, title: 'Inbox review' },
      threadId: null,
    });
  });

  it('rejects a bad cursor or limit', async () => {
    const { user } = await setup(0);
    const badCursor = await get(user, `${BASE}?cursor=nope`);
    expect(badCursor.statusCode).toBe(400);
    expect(ErrorResponseSchema.parse(badCursor.json()).error.code).toBe('invalid_cursor');
    expect((await get(user, `${BASE}?limit=0`)).statusCode).toBe(422);
    expect((await get(user, `${BASE}?limit=51`)).statusCode).toBe(422);
  });

  it('counts unread, and marking read is idempotent', async () => {
    const { user, ids } = await setup(3);
    expect(await unread(user)).toBe(3);

    expect((await post(user, `${BASE}/${ids[0]}/read`)).statusCode).toBe(204);
    const firstRead = (await list(user)).items.find((n) => n.id === ids[0])!.readAt;
    expect(firstRead).not.toBeNull();
    expect((await post(user, `${BASE}/${ids[0]}/read`)).statusCode).toBe(204);
    expect((await list(user)).items.find((n) => n.id === ids[0])!.readAt).toBe(firstRead);
    expect(await unread(user)).toBe(2);

    expect((await post(user, `${BASE}/read-all`)).statusCode).toBe(204);
    expect(await unread(user)).toBe(0);
    expect((await post(user, `${BASE}/read-all`)).statusCode).toBe(204);
    expect(await unread(user)).toBe(0);
    expect((await list(user)).items.find((n) => n.id === ids[0])!.readAt).toBe(firstRead);
  });

  it("answers 404 for someone else's notification and leaves it unread", async () => {
    const owner = await setup(1);
    const intruder = await setup(0);
    for (const id of [owner.ids[0], randomUUID(), 'not-a-uuid']) {
      const res = await post(intruder.user, `${BASE}/${id}/read`);
      expect(res.statusCode).toBe(404);
      expect(ErrorResponseSchema.parse(res.json()).error.code).toBe('notification_not_found');
    }
    await post(intruder.user, `${BASE}/read-all`);
    expect((await list(intruder.user)).items).toEqual([]);
    expect(await unread(owner.user)).toBe(1);
  });

  it('hides notifications from a workspace the user has left', async () => {
    const { user, actor, ids } = await setup(1);
    const other = await createWorkspace(app.db, actor.id, { name: 'Left' });
    await addMember(app.db, other.id, user.id, 'member');
    const otherReview = await createReview(app.db, {
      workspaceId: other.id,
      authorId: actor.id,
      input: { title: 'Secret plans', description: null, patch: PATCH },
    });
    const [hidden] = await insertFor(user.id, other.id, otherReview.id, actor.id, 1);
    expect(await unread(user)).toBe(2);

    await app.db
      .delete(workspaceMembers)
      .where(and(eq(workspaceMembers.workspaceId, other.id), eq(workspaceMembers.userId, user.id)));

    expect((await list(user)).items.map((n) => n.id)).toEqual(ids);
    expect(await unread(user)).toBe(1);
    expect((await post(user, `${BASE}/${hidden}/read`)).statusCode).toBe(404);
    await post(user, `${BASE}/read-all`);
    const [row] = await app.db
      .select({ readAt: notifications.readAt })
      .from(notifications)
      .where(eq(notifications.id, hidden!));
    expect(row?.readAt).toBeNull();
  });

  it('lists with one query, however many notifications', async () => {
    const pool = app.db.$client;
    for (const count of [1, 20]) {
      const { user } = await setup(count);
      const spy = vi.spyOn(pool, 'query');
      const page = await listNotifications(app.db, user.id, { limit: 20 });
      expect(spy.mock.calls.length).toBe(1);
      spy.mockRestore();
      expect(page.items).toHaveLength(count);
    }
  });
});
