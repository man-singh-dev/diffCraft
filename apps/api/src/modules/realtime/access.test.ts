import { PresenceEventSchema, type PresenceEvent } from '@diffcraft/shared';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Socket as ClientSocket } from 'socket.io-client';
import { beforeAll, expect, it } from 'vitest';
import { sessions, users, workspaceMembers } from '../../db/schema/index.js';
import { addMember, createUserWithSession, type TestUser } from '../../test/fixtures.js';
import {
  closeRealtimeResourcesAfterTests,
  connectAs,
  createReview,
  createWorkspace,
  join,
  nextEvent,
  receivedWithin,
  startApp,
  TICKET_URL,
} from '../../test/realtime.js';
import { describeWithDbAndRedis } from '../../test/redis.js';
import { createSession, hashSessionToken, SESSION_COOKIE_NAME } from '../auth/session.js';

const PROBE = 'test:probe' as never;
const QUIET_MS = 800;

interface Instance {
  app: FastifyInstance;
  url: string;
}

async function user(app: FastifyInstance, displayName = 'Test') {
  const created = await createUserWithSession(app.db);
  await app.db.update(users).set({ displayName }).where(eq(users.id, created.id));
  return created;
}

// Each instance's Redis subscriptions may still be starting: wait until both directions deliver.
async function linkInstances(a: Instance, b: Instance) {
  const probe = await user(a.app);
  const onA = await connectAs(a.app, a.url, probe);
  const onB = await connectAs(b.app, b.url, probe);
  for (const [from, to] of [
    [b.app, onA],
    [a.app, onB],
  ] as const) {
    const received = nextEvent(to, PROBE, 5_000);
    const timer = setInterval(() => from.realtime.emitToUser(probe.id, PROBE, {} as never), 100);
    try {
      await received;
    } finally {
      clearInterval(timer);
    }
  }
  onA.disconnect();
  onB.disconnect();
}

async function postThread(
  app: FastifyInstance,
  author: TestUser,
  workspaceId: string,
  reviewNumber: number,
) {
  const res = await app.inject({
    method: 'POST',
    url: `/api/v1/workspaces/${workspaceId}/reviews/${reviewNumber}/threads`,
    cookies: author.cookies,
    payload: { body: 'A comment' },
  });
  expect(res.statusCode).toBe(201);
}

function presenceMatching(
  socket: ClientSocket,
  predicate: (event: PresenceEvent) => boolean,
): Promise<PresenceEvent> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off('presence', listener);
      reject(new Error('no matching presence within 5000 ms'));
    }, 5_000);
    function listener(payload: unknown) {
      const event = PresenceEventSchema.parse(payload);
      if (!predicate(event)) return;
      clearTimeout(timer);
      socket.off('presence', listener);
      resolve(event);
    }
    socket.on('presence', listener);
  });
}

closeRealtimeResourcesAfterTests();

describeWithDbAndRedis('revoking real-time access', () => {
  let a: Instance;
  let b: Instance;

  beforeAll(async () => {
    a = await startApp();
    b = await startApp();
    await linkInstances(a, b);
  });

  async function workspaceWithReview() {
    const owner = await user(a.app, 'Owner');
    const workspace = await createWorkspace(a.app, owner);
    const review = await createReview(a.app, owner, workspace.id);
    const room = { workspaceId: workspace.id, reviewNumber: review.number };
    return { owner, workspaceId: workspace.id, review, room };
  }

  it('evicts a removed member on another instance at once, and only from that workspace', async () => {
    const { owner, workspaceId, review, room } = await workspaceWithReview();
    const stays = await user(a.app);
    const removed = await user(a.app);
    await addMember(a.app.db, workspaceId, stays.id, 'member');
    await addMember(a.app.db, workspaceId, removed.id, 'member');
    const elsewhere = await createWorkspace(a.app, removed);
    const elsewhereReview = await createReview(a.app, removed, elsewhere.id);

    const removedOnB = await connectAs(b.app, b.url, removed);
    const staysOnB = await connectAs(b.app, b.url, stays);
    const staysOnA = await connectAs(a.app, a.url, stays);
    for (const socket of [removedOnB, staysOnB, staysOnA]) {
      expect(await join(socket, room)).toMatchObject({ ok: true });
    }
    expect(
      await join(removedOnB, { workspaceId: elsewhere.id, reviewNumber: elsewhereReview.number }),
    ).toMatchObject({ ok: true });

    const revoked = nextEvent(removedOnB, 'review:access-revoked');
    const res = await a.app.inject({
      method: 'DELETE',
      url: `/api/v1/workspaces/${workspaceId}/members/${removed.id}`,
      cookies: owner.cookies,
    });
    expect(res.statusCode).toBe(204);
    expect(await revoked).toEqual({ reviewId: review.id, reason: 'removed' });

    // Right after the response, from both instances (B emits to its own sockets without going through Redis).
    const quiet = receivedWithin(removedOnB, 'thread:upsert', QUIET_MS);
    const forStaysOnB = nextEvent(staysOnB, 'thread:upsert');
    const forStaysOnA = nextEvent(staysOnA, 'thread:upsert');
    await postThread(b.app, owner, workspaceId, review.number);
    await postThread(a.app, owner, workspaceId, review.number);
    await Promise.all([forStaysOnB, forStaysOnA]);
    expect(await quiet).toBe(false);

    const fromOtherWorkspace = nextEvent(removedOnB, 'thread:upsert');
    await postThread(a.app, removed, elsewhere.id, elsewhereReview.number);
    expect(await fromOtherWorkspace).toMatchObject({ reviewId: elsewhereReview.id });
  });

  it('evicts a member who leaves the workspace', async () => {
    const { workspaceId, review, room } = await workspaceWithReview();
    const leaver = await user(a.app);
    await addMember(a.app.db, workspaceId, leaver.id, 'member');
    const socket = await connectAs(b.app, b.url, leaver);
    expect(await join(socket, room)).toMatchObject({ ok: true });

    const revoked = nextEvent(socket, 'review:access-revoked');
    const res = await a.app.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${workspaceId}/members/leave`,
      cookies: leaver.cookies,
    });
    expect(res.statusCode).toBe(204);
    expect(await revoked).toEqual({ reviewId: review.id, reason: 'removed' });
  });

  it('evicts every member when the workspace is deleted', async () => {
    const { owner, workspaceId, review, room } = await workspaceWithReview();
    const member = await user(a.app);
    await addMember(a.app.db, workspaceId, member.id, 'viewer');
    const ownerOnA = await connectAs(a.app, a.url, owner);
    const memberOnB = await connectAs(b.app, b.url, member);
    expect(await join(ownerOnA, room)).toMatchObject({ ok: true });
    expect(await join(memberOnB, room)).toMatchObject({ ok: true });

    const events = [ownerOnA, memberOnB].map((s) => nextEvent(s, 'review:access-revoked'));
    const res = await a.app.inject({
      method: 'DELETE',
      url: `/api/v1/workspaces/${workspaceId}`,
      cookies: owner.cookies,
    });
    expect(res.statusCode).toBe(204);
    for (const event of await Promise.all(events)) {
      expect(event).toEqual({ reviewId: review.id, reason: 'workspace_deleted' });
    }
  });

  it('keeps a member whose role changes to viewer: viewers may still watch', async () => {
    const { owner, workspaceId, review, room } = await workspaceWithReview();
    const member = await user(a.app);
    await addMember(a.app.db, workspaceId, member.id, 'member');
    const socket = await connectAs(b.app, b.url, member);
    expect(await join(socket, room)).toMatchObject({ ok: true });

    const quiet = receivedWithin(socket, 'review:access-revoked', QUIET_MS);
    const res = await a.app.inject({
      method: 'PATCH',
      url: `/api/v1/workspaces/${workspaceId}/members/${member.id}`,
      cookies: owner.cookies,
      payload: { role: 'viewer' },
    });
    expect(res.statusCode).toBe(200);
    const thread = nextEvent(socket, 'thread:upsert');
    await postThread(a.app, owner, workspaceId, review.number);
    expect(await thread).toMatchObject({ reviewId: review.id });
    expect(await quiet).toBe(false);
  });

  it('drops a removed member from presence', async () => {
    const { owner, workspaceId, review, room } = await workspaceWithReview();
    const removed = await user(a.app, 'Removed');
    await addMember(a.app.db, workspaceId, removed.id, 'member');
    const ownerOnA = await connectAs(a.app, a.url, owner);
    const removedOnB = await connectAs(b.app, b.url, removed);
    await join(ownerOnA, room);
    const both = presenceMatching(ownerOnA, (e) => e.reviewId === review.id && e.total === 2);
    await join(removedOnB, room);
    await both;

    const alone = presenceMatching(ownerOnA, (e) => e.reviewId === review.id && e.total === 1);
    await a.app.inject({
      method: 'DELETE',
      url: `/api/v1/workspaces/${workspaceId}/members/${removed.id}`,
      cookies: owner.cookies,
    });
    expect((await alone).viewers.map((v) => v.displayName)).toEqual(['Owner']);
  });

  it("disconnects only the logged-out session's sockets, on every instance", async () => {
    const person = await user(a.app);
    const { token: otherToken } = await createSession(a.app.db, person.id);
    const otherSession: TestUser = { ...person, cookies: { [SESSION_COOKIE_NAME]: otherToken } };

    const firstOnA = await connectAs(a.app, a.url, person);
    const firstOnB = await connectAs(b.app, b.url, person);
    const second = await connectAs(b.app, b.url, otherSession);

    const dropped = [firstOnA, firstOnB].map((s) => nextEvent(s, 'disconnect'));
    const secondQuiet = receivedWithin(second, 'disconnect', QUIET_MS);
    const res = await a.app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      cookies: person.cookies,
    });
    expect(res.statusCode).toBe(204);
    expect(await Promise.all(dropped)).toEqual(['io server disconnect', 'io server disconnect']);
    expect(await secondQuiet).toBe(false);
    expect(second.connected).toBe(true);

    const ticket = await a.app.inject({ method: 'POST', url: TICKET_URL, cookies: person.cookies });
    expect(ticket.statusCode).toBe(401);
  });

  it('safety net: evicts sockets whose membership or session was deleted directly in the database', async () => {
    const { workspaceId, review, room } = await workspaceWithReview();
    const removed = await user(a.app);
    const expired = await user(a.app);
    const stays = await user(a.app);
    for (const member of [removed, expired, stays]) {
      await addMember(a.app.db, workspaceId, member.id, 'member');
    }
    const removedSocket = await connectAs(a.app, a.url, removed);
    const expiredSocket = await connectAs(a.app, a.url, expired);
    const staysSocket = await connectAs(a.app, a.url, stays);
    for (const socket of [removedSocket, expiredSocket, staysSocket]) {
      expect(await join(socket, room)).toMatchObject({ ok: true });
    }

    await a.app.db
      .delete(workspaceMembers)
      .where(
        and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, removed.id)),
      );
    await a.app.db
      .delete(sessions)
      .where(eq(sessions.id, hashSessionToken(expired.cookies[SESSION_COOKIE_NAME]!)));

    const revoked = nextEvent(removedSocket, 'review:access-revoked');
    const disconnected = nextEvent(expiredSocket, 'disconnect');
    const staysQuiet = Promise.all([
      receivedWithin(staysSocket, 'review:access-revoked', QUIET_MS),
      receivedWithin(staysSocket, 'disconnect', QUIET_MS),
    ]);
    const result = await a.app.realtime.checkLocalSockets();
    expect(result.evicted).toBeGreaterThanOrEqual(1);
    expect(result.disconnected).toBeGreaterThanOrEqual(1);
    expect(await revoked).toEqual({ reviewId: review.id, reason: 'removed' });
    expect(await disconnected).toBe('io server disconnect');
    expect(await staysQuiet).toEqual([false, false]);

    const quiet = receivedWithin(removedSocket, 'thread:upsert', QUIET_MS);
    const forStays = nextEvent(staysSocket, 'thread:upsert');
    await postThread(a.app, stays, workspaceId, review.number);
    await forStays;
    expect(await quiet).toBe(false);
  });
});
