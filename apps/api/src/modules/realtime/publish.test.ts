import { randomUUID } from 'node:crypto';
import {
  CommentSchema,
  ReviewRoomEventSchemas,
  ThreadSchema,
  type ReviewChangeReason,
  type ReviewChangedEvent,
  type ReviewDeletedEvent,
  type ThreadUpsertEvent,
} from '@diffcraft/shared';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import type { Socket as ClientSocket } from 'socket.io-client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { addMember, createUserWithSession, type TestUser } from '../../test/fixtures.js';
import {
  closeRealtimeResourcesAfterTests,
  connectAs,
  createReview,
  createWorkspace,
  join,
  nextEvent,
  recordEvents,
  startApp,
  type ReceivedEvent,
} from '../../test/realtime.js';
import { describeWithDbAndRedis } from '../../test/redis.js';

const SETTLE_MS = 300;
const TEST_EVENT = 'test:event' as never;

closeRealtimeResourcesAfterTests();

afterEach(() => {
  vi.restoreAllMocks();
});

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

function validate({ event, payload }: ReceivedEvent) {
  expect(Object.keys(ReviewRoomEventSchemas)).toContain(event);
  return ReviewRoomEventSchemas[event as keyof typeof ReviewRoomEventSchemas].parse(payload);
}

describeWithDbAndRedis('realtime domain events', () => {
  let app: FastifyInstance;
  let url: string;
  let author: TestUser;
  let member: TestUser;
  let viewer: TestUser;
  let outsider: TestUser;
  let workspaceId: string;

  beforeAll(async () => {
    ({ app, url } = await startApp());
    author = await createUserWithSession(app.db);
    member = await createUserWithSession(app.db);
    viewer = await createUserWithSession(app.db);
    outsider = await createUserWithSession(app.db);
    workspaceId = (await createWorkspace(app, author)).id;
    await addMember(app.db, workspaceId, member.id, 'member');
    await addMember(app.db, workspaceId, viewer.id, 'viewer');
    await createWorkspace(app, outsider);
  });

  const reviewUrl = (number: number, path = '') =>
    `/api/v1/workspaces/${workspaceId}/reviews/${number}${path}`;

  const call = (user: TestUser, method: Method, path: string, payload?: object) =>
    app.inject({ method, url: path, cookies: user.cookies, ...(payload && { payload }) });

  async function newReview() {
    return createReview(app, author, workspaceId);
  }

  async function joinedSocket(reviewNumber: number, user: TestUser = viewer) {
    const socket = await connectAs(app, url, user);
    expect(await join(socket, { workspaceId, reviewNumber })).toMatchObject({ ok: true });
    return socket;
  }

  // Sockets that must never see this review's events: not joined, in another review, and a stranger refused at join.
  async function bystanders(reviewNumber: number) {
    const notJoined = await connectAs(app, url, viewer);
    const elsewhere = await joinedSocket((await newReview()).number);
    const stranger = await connectAs(app, url, outsider);
    expect(await join(stranger, { workspaceId, reviewNumber })).toEqual({
      ok: false,
      error: 'not_found',
    });
    return [notJoined, elsewhere, stranger];
  }

  async function recordDuring(sockets: ClientSocket[], action: () => Promise<void>) {
    const recorders = sockets.map(recordEvents);
    await action();
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
    for (const recorder of recorders) recorder.stop();
    return recorders.map((recorder) => recorder.events);
  }

  describe('comments', () => {
    it('emits one thread:upsert per action, only to the review room, with the current thread', async () => {
      const review = await newReview();
      const listener = await joinedSocket(review.number);
      const others = await bystanders(review.number);
      const threadsUrl = reviewUrl(review.number, '/threads');
      let lastAt = '';

      async function expectUpsert(
        actor: TestUser,
        action: () => Promise<LightMyRequestResponse>,
        expectedStatus: number,
      ): Promise<ThreadUpsertEvent> {
        const [received = [], ...quiet] = await recordDuring([listener, ...others], async () => {
          const res = await action();
          expect(res.statusCode, res.body).toBe(expectedStatus);
        });
        expect(quiet).toEqual([[], [], []]);
        expect(received.map((e) => e.event)).toEqual(['thread:upsert']);
        const event = validate(received[0]!) as ThreadUpsertEvent;
        expect(event.reviewId).toBe(review.id);
        expect(event.actorId).toBe(actor.id);
        expect(event.at > lastAt).toBe(true);
        lastAt = event.at;

        const current = await call(viewer, 'GET', threadsUrl);
        const threads = ThreadSchema.array().parse(current.json());
        expect(event.thread).toEqual(threads.find((thread) => thread.id === event.thread.id));
        return event;
      }

      const created = await expectUpsert(
        member,
        () => call(member, 'POST', threadsUrl, { body: 'First thought' }),
        201,
      );
      expect(created.thread.comments).toHaveLength(1);
      const threadId = created.thread.id;
      const firstComment = created.thread.comments[0]!;

      const replied = await expectUpsert(
        author,
        () => call(author, 'POST', `${threadsUrl}/${threadId}/comments`, { body: 'Reply' }),
        201,
      );
      expect(replied.thread.comments.map((c) => c.body)).toEqual(['First thought', 'Reply']);

      const edited = await expectUpsert(
        member,
        () =>
          call(member, 'PATCH', `${threadsUrl}/${threadId}/comments/${firstComment.id}`, {
            body: 'Second thought',
          }),
        200,
      );
      expect(edited.thread.comments[0]).toMatchObject({ body: 'Second thought', edited: true });

      const deleted = await expectUpsert(
        member,
        () => call(member, 'DELETE', `${threadsUrl}/${threadId}/comments/${firstComment.id}`),
        200,
      );
      expect(CommentSchema.parse(deleted.thread.comments[0])).toMatchObject({
        deleted: true,
        body: '',
      });

      const resolved = await expectUpsert(
        author,
        () => call(author, 'PATCH', `${threadsUrl}/${threadId}`, { status: 'resolved' }),
        200,
      );
      expect(resolved.thread.status).toBe('resolved');
    });
  });

  describe('approvals and reviews', () => {
    async function expectChanged(
      review: { id: string; number: number },
      listener: ClientSocket,
      actor: TestUser,
      method: Method,
      path: string,
      payload: object | undefined,
      expected: { status: number; reason: ReviewChangeReason },
    ) {
      const [received] = await recordDuring([listener], async () => {
        const res = await call(actor, method, reviewUrl(review.number, path), payload);
        expect(res.statusCode, res.body).toBe(expected.status);
      });
      expect(received!.map((e) => e.event)).toEqual(['review:changed']);
      const event = validate(received![0]!) as ReviewChangedEvent;
      expect(event).toMatchObject({
        reviewId: review.id,
        actorId: actor.id,
        reason: expected.reason,
      });
    }

    it('emits review:changed for reviewers, decisions and merge', async () => {
      const review = await newReview();
      const listener = await joinedSocket(review.number);
      const others = await bystanders(review.number);
      const quiet = await recordDuring(others, async () => {
        const assign = { userIds: [member.id] };
        await expectChanged(review, listener, author, 'POST', '/reviewers', assign, {
          status: 200,
          reason: 'reviewers',
        });
        await expectChanged(
          review,
          listener,
          author,
          'DELETE',
          `/reviewers/${member.id}`,
          undefined,
          {
            status: 204,
            reason: 'reviewers',
          },
        );
        await expectChanged(review, listener, author, 'POST', '/reviewers', assign, {
          status: 200,
          reason: 'reviewers',
        });
        await expectChanged(
          review,
          listener,
          member,
          'POST',
          '/decisions',
          { decision: 'approve' },
          { status: 201, reason: 'decision' },
        );
        await expectChanged(review, listener, author, 'POST', '/merge', undefined, {
          status: 200,
          reason: 'merged',
        });
      });
      expect(quiet).toEqual([[], [], []]);
    });

    it('emits review:changed for edits and status changes, and review:deleted on delete', async () => {
      const review = await newReview();
      const listener = await joinedSocket(review.number);

      await expectChanged(
        review,
        listener,
        author,
        'PATCH',
        '',
        { title: 'Renamed' },
        {
          status: 200,
          reason: 'updated',
        },
      );
      await expectChanged(
        review,
        listener,
        author,
        'PATCH',
        '',
        { status: 'closed' },
        {
          status: 200,
          reason: 'status',
        },
      );
      await expectChanged(
        review,
        listener,
        author,
        'PATCH',
        '',
        { status: 'open' },
        {
          status: 200,
          reason: 'status',
        },
      );

      const [received] = await recordDuring([listener], async () => {
        const res = await call(author, 'DELETE', reviewUrl(review.number));
        expect(res.statusCode).toBe(204);
      });
      expect(received!.map((e) => e.event)).toEqual(['review:deleted']);
      const event = validate(received![0]!) as ReviewDeletedEvent;
      expect(event).toEqual({ reviewId: review.id, actorId: author.id, at: expect.any(String) });
    });
  });

  describe('failed requests', () => {
    it('emit nothing', async () => {
      const review = await newReview();
      const listener = await joinedSocket(review.number);
      const threadsUrl = reviewUrl(review.number, '/threads');

      const [received] = await recordDuring([listener], async () => {
        const failures: [TestUser, Method, string, object | undefined, number][] = [
          [viewer, 'POST', threadsUrl, { body: 'Viewers cannot comment' }, 403],
          [member, 'POST', `${threadsUrl}/${randomUUID()}/comments`, { body: 'Hi' }, 404],
          [member, 'POST', threadsUrl, { body: '   ' }, 422],
          [author, 'POST', reviewUrl(review.number, '/merge'), undefined, 409],
          [author, 'PATCH', reviewUrl(review.number), { title: '' }, 422],
          [member, 'DELETE', reviewUrl(review.number), undefined, 403],
          [author, 'DELETE', reviewUrl(review.number, `/reviewers/${member.id}`), undefined, 404],
          [member, 'POST', reviewUrl(review.number, '/decisions'), { decision: 'approve' }, 403],
        ];
        for (const [user, method, path, payload, status] of failures) {
          const res = await call(user, method, path, payload);
          expect(res.statusCode, `${method} ${path}: ${res.body}`).toBe(status);
        }
      });
      expect(received).toEqual([]);
    });
  });

  describe('a failing emit', () => {
    it('still returns the normal success response', async () => {
      const review = await newReview();
      const emit = vi.spyOn(app.realtime, 'emitToReview').mockImplementation(() => {
        throw new Error('emit failed');
      });

      const created = await call(member, 'POST', reviewUrl(review.number, '/threads'), {
        body: 'Still saved',
      });
      expect(created.statusCode).toBe(201);
      expect(ThreadSchema.parse(created.json()).comments[0]!.body).toBe('Still saved');

      const renamed = await call(author, 'PATCH', reviewUrl(review.number), { title: 'Still' });
      expect(renamed.statusCode).toBe(200);
      expect(renamed.json()).toMatchObject({ title: 'Still' });

      const deleted = await call(author, 'DELETE', reviewUrl(review.number));
      expect(deleted.statusCode).toBe(204);
      expect(emit).toHaveBeenCalledTimes(3);
    });
  });

  describe('several instances', () => {
    it('delivers an action taken on instance A to a socket on instance B', async () => {
      const a = await startApp();
      const b = await startApp();
      const review = await newReview();
      const socket = await connectAs(b.app, b.url, viewer);
      expect(await join(socket, { workspaceId, reviewNumber: review.number })).toMatchObject({
        ok: true,
      });

      // A's adapter may still be subscribing: wait until one of its emits reaches B's socket.
      const ready = nextEvent(socket, 'test:event', 5_000);
      const timer = setInterval(
        () => a.app.realtime.emitToReview(review.id, TEST_EVENT, {} as never),
        100,
      );
      try {
        await ready;
      } finally {
        clearInterval(timer);
      }

      const received = nextEvent(socket, 'review:changed', 5_000);
      const res = await a.app.inject({
        method: 'PATCH',
        url: reviewUrl(review.number),
        cookies: author.cookies,
        payload: { title: 'From A' },
      });
      expect(res.statusCode).toBe(200);
      expect(ReviewRoomEventSchemas['review:changed'].parse(await received)).toMatchObject({
        reviewId: review.id,
        actorId: author.id,
        reason: 'updated',
      });
    });
  });
});
