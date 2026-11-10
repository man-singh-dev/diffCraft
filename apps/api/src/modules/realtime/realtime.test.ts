import { randomBytes, randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import {
  ErrorResponseSchema,
  REALTIME_PATH,
  RealtimeTicketResponseSchema,
  ReviewSchema,
  WorkspaceSchema,
  type ReviewJoinAck,
  type ReviewJoinRequest,
  type ReviewLeaveAck,
} from '@diffcraft/shared';
import type { RedisAdapter } from '@socket.io/redis-adapter';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { io as connectClient, type Socket as ClientSocket } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';
import { users } from '../../db/schema/index.js';
import { testDatabaseUrl } from '../../test/db.js';
import { FakeMailer } from '../../test/fake-mailer.js';
import { addMember, createUserWithSession, type TestUser } from '../../test/fixtures.js';
import { describeWithDbAndRedis, testRedisUrl } from '../../test/redis.js';
import type { RealtimeLimits } from './socket-server.js';
import { ticketKey } from './ticket.js';

const WEB_ORIGIN = 'http://localhost:3000';
const TICKET_URL = '/api/v1/realtime/ticket';
const PATCH = `--- a/a.txt
+++ b/a.txt
@@ -1 +1 @@
-old
+new
`;
const TEST_EVENT = 'test:event' as never;

const openSockets = new Set<ClientSocket>();
const openApps = new Set<FastifyInstance>();

afterEach(() => {
  for (const socket of openSockets) socket.disconnect();
  openSockets.clear();
});

afterAll(async () => {
  await Promise.all([...openApps].map((app) => app.close()));
});

async function startApp(realtimeLimits?: Partial<RealtimeLimits>) {
  const app = await buildApp(
    loadConfig({
      LOG_LEVEL: 'silent',
      DATABASE_URL: testDatabaseUrl,
      REDIS_URL: testRedisUrl ?? undefined,
      WEB_ORIGIN,
    }),
    { mailer: new FakeMailer(), ...(realtimeLimits && { realtimeLimits }) },
  );
  openApps.add(app);
  await app.listen({ host: '127.0.0.1', port: 0 });
  const { port } = app.server.address() as AddressInfo;
  return { app, url: `http://127.0.0.1:${port}` };
}

async function getTicket(app: FastifyInstance, user: TestUser): Promise<string> {
  const res = await app.inject({ method: 'POST', url: TICKET_URL, cookies: user.cookies });
  expect(res.statusCode).toBe(200);
  return RealtimeTicketResponseSchema.parse(res.json()).ticket;
}

function connect(
  url: string,
  auth: Record<string, unknown>,
  origin: string = WEB_ORIGIN,
): Promise<ClientSocket> {
  const socket = connectClient(url, {
    path: REALTIME_PATH,
    transports: ['websocket'],
    auth,
    extraHeaders: { origin },
    reconnection: false,
    forceNew: true,
  });
  openSockets.add(socket);
  return new Promise((resolve, reject) => {
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', (err) => {
      socket.disconnect();
      reject(err);
    });
  });
}

const join = (socket: ClientSocket, request: unknown): Promise<ReviewJoinAck> =>
  socket.timeout(5_000).emitWithAck('review:join', request as ReviewJoinRequest);

const leave = (socket: ClientSocket, reviewId: string): Promise<ReviewLeaveAck> =>
  socket.timeout(5_000).emitWithAck('review:leave', { reviewId });

async function createWorkspace(app: FastifyInstance, owner: TestUser) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/workspaces',
    cookies: owner.cookies,
    payload: { name: 'Realtime' },
  });
  return WorkspaceSchema.parse(res.json());
}

async function createReview(app: FastifyInstance, owner: TestUser, workspaceId: string) {
  const res = await app.inject({
    method: 'POST',
    url: `/api/v1/workspaces/${workspaceId}/reviews`,
    cookies: owner.cookies,
    payload: { title: 'Change', patch: PATCH },
  });
  return ReviewSchema.parse(res.json());
}

function nextEvent(socket: ClientSocket, event: string, timeoutMs = 3_000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`no ${event} within ${timeoutMs} ms`)),
      timeoutMs,
    );
    socket.once(event, (payload: unknown) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

async function receivedWithin(socket: ClientSocket, event: string, ms: number) {
  let received = false;
  const listener = () => (received = true);
  socket.on(event, listener);
  await new Promise((resolve) => setTimeout(resolve, ms));
  socket.off(event, listener);
  return received;
}

describeWithDbAndRedis('realtime', () => {
  let app: FastifyInstance;
  let url: string;
  let owner: TestUser;
  let viewer: TestUser;
  let outsider: TestUser;
  let workspaceId: string;
  let reviewId: string;
  let reviewNumber: number;

  beforeAll(async () => {
    ({ app, url } = await startApp());
    owner = await createUserWithSession(app.db);
    viewer = await createUserWithSession(app.db);
    outsider = await createUserWithSession(app.db);
    workspaceId = (await createWorkspace(app, owner)).id;
    await addMember(app.db, workspaceId, viewer.id, 'viewer');
    const review = await createReview(app, owner, workspaceId);
    reviewId = review.id;
    reviewNumber = review.number;
  });

  describe('POST /api/v1/realtime/ticket', () => {
    it('requires a session', async () => {
      const res = await app.inject({ method: 'POST', url: TICKET_URL });
      expect(res.statusCode).toBe(401);
      expect(ErrorResponseSchema.parse(res.json()).error.code).toBe('unauthenticated');
    });

    it('rejects another origin like every other POST', async () => {
      const res = await app.inject({
        method: 'POST',
        url: TICKET_URL,
        cookies: viewer.cookies,
        headers: { origin: 'https://evil.example' },
      });
      expect(res.statusCode).toBe(403);
    });

    it('returns a 43-char ticket, uncached, and stores only its hash for at most 30 s', async () => {
      const res = await app.inject({ method: 'POST', url: TICKET_URL, cookies: viewer.cookies });
      expect(res.statusCode).toBe(200);
      expect(res.headers['cache-control']).toBe('no-store');
      const { ticket, expiresInSeconds } = RealtimeTicketResponseSchema.parse(res.json());
      expect(ticket).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(expiresInSeconds).toBe(30);

      const key = ticketKey(ticket);
      expect(key).not.toContain(ticket);
      const ttl = await app.redis.ttl(key);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(30);
      const value = await app.redis.get(key);
      expect(JSON.parse(value!)).toEqual({ userId: viewer.id });
      expect(await app.redis.keys(`*${ticket}*`)).toEqual([]);
    });
  });

  describe('handshake', () => {
    it('connects with a valid ticket', async () => {
      const socket = await connect(url, { ticket: await getTicket(app, viewer) });
      expect(socket.connected).toBe(true);
    });

    it('accepts a ticket only once', async () => {
      const ticket = await getTicket(app, viewer);
      await connect(url, { ticket });
      await expect(connect(url, { ticket })).rejects.toThrow('unauthorized');
    });

    it.each([
      ['no auth', {}],
      ['a random ticket', { ticket: randomBytes(32).toString('base64url') }],
      ['a malformed ticket', { ticket: 'short' }],
      ['a non-string ticket', { ticket: 42 }],
    ])('rejects %s', async (_, auth) => {
      await expect(connect(url, auth)).rejects.toThrow('unauthorized');
    });

    it('rejects an expired ticket', async () => {
      const ticket = await getTicket(app, viewer);
      await app.redis.pexpire(ticketKey(ticket), 1);
      await new Promise((resolve) => setTimeout(resolve, 20));
      await expect(connect(url, { ticket })).rejects.toThrow('unauthorized');
    });

    it('rejects a ticket whose user was deleted', async () => {
      const doomed = await createUserWithSession(app.db);
      const ticket = await getTicket(app, doomed);
      await app.db.delete(users).where(eq(users.id, doomed.id));
      await expect(connect(url, { ticket })).rejects.toThrow('unauthorized');
    });

    it('rejects another origin without using up the ticket', async () => {
      const ticket = await getTicket(app, viewer);
      await expect(connect(url, { ticket }, 'https://evil.example')).rejects.toThrow();
      await expect(connect(url, { ticket })).resolves.toBeTruthy();
    });
  });

  describe('review:join / review:leave', () => {
    it('lets a viewer join and returns the review id', async () => {
      const socket = await connect(url, { ticket: await getTicket(app, viewer) });
      expect(await join(socket, { workspaceId, reviewNumber })).toEqual({ ok: true, reviewId });
    });

    it('answers not_found to a non-member and for a missing review alike', async () => {
      const stranger = await connect(url, { ticket: await getTicket(app, outsider) });
      expect(await join(stranger, { workspaceId, reviewNumber })).toEqual({
        ok: false,
        error: 'not_found',
      });
      const member = await connect(url, { ticket: await getTicket(app, viewer) });
      expect(await join(member, { workspaceId, reviewNumber: 999_999 })).toEqual({
        ok: false,
        error: 'not_found',
      });
      expect(await join(member, { workspaceId: randomUUID(), reviewNumber })).toEqual({
        ok: false,
        error: 'not_found',
      });
    });

    it('never finds a review through another workspace, even for a member of both', async () => {
      const both = await createUserWithSession(app.db);
      const empty = await createWorkspace(app, both);
      const other = await createWorkspace(app, both);
      const otherReview = await createReview(app, both, other.id);

      const socket = await connect(url, { ticket: await getTicket(app, both) });
      expect(
        await join(socket, { workspaceId: empty.id, reviewNumber: otherReview.number }),
      ).toEqual({ ok: false, error: 'not_found' });
      expect(
        await join(socket, { workspaceId: other.id, reviewNumber: otherReview.number }),
      ).toEqual({ ok: true, reviewId: otherReview.id });
      const stranger = await connect(url, { ticket: await getTicket(app, viewer) });
      expect(
        await join(stranger, { workspaceId: other.id, reviewNumber: otherReview.number }),
      ).toEqual({ ok: false, error: 'not_found' });
    });

    it.each([
      null,
      'review',
      {},
      { workspaceId: 'not-a-uuid', reviewNumber: 1 },
      { workspaceId: randomUUID(), reviewNumber: '1' },
      { workspaceId: randomUUID(), reviewNumber: 0 },
      { workspaceId: randomUUID(), reviewNumber: 1.5 },
      { workspaceId: randomUUID(), reviewNumber: 2_147_483_648 },
    ])('rejects malformed request %j', async (request) => {
      const socket = await connect(url, { ticket: await getTicket(app, viewer) });
      expect(await join(socket, request)).toEqual({ ok: false, error: 'invalid_request' });
    });

    it('rejects a malformed leave', async () => {
      const socket = await connect(url, { ticket: await getTicket(app, viewer) });
      expect(await leave(socket, 'nope')).toEqual({ ok: false, error: 'invalid_request' });
    });
  });

  describe('limits', () => {
    it('rate-limits joins per socket, counting malformed ones too', async () => {
      const limited = await startApp({ maxJoins: 3, joinWindowMs: 60_000 });
      const socket = await connect(limited.url, { ticket: await getTicket(limited.app, viewer) });
      expect(await join(socket, {})).toEqual({ ok: false, error: 'invalid_request' });
      expect(await join(socket, { workspaceId, reviewNumber })).toMatchObject({ ok: true });
      expect(await join(socket, { workspaceId, reviewNumber })).toMatchObject({ ok: true });
      expect(await join(socket, { workspaceId, reviewNumber })).toEqual({
        ok: false,
        error: 'rate_limited',
      });

      const fresh = await connect(limited.url, { ticket: await getTicket(limited.app, viewer) });
      expect(await join(fresh, { workspaceId, reviewNumber })).toMatchObject({ ok: true });
    });

    it('caps the review rooms per socket, but rejoining a room is fine', async () => {
      const capped = await startApp({ maxRoomsPerSocket: 2 });
      const second = await createReview(app, owner, workspaceId);
      const third = await createReview(app, owner, workspaceId);
      const socket = await connect(capped.url, { ticket: await getTicket(capped.app, viewer) });

      expect(await join(socket, { workspaceId, reviewNumber })).toMatchObject({ ok: true });
      expect(await join(socket, { workspaceId, reviewNumber: second.number })).toMatchObject({
        ok: true,
      });
      expect(await join(socket, { workspaceId, reviewNumber: third.number })).toEqual({
        ok: false,
        error: 'too_many_rooms',
      });
      expect(await join(socket, { workspaceId, reviewNumber })).toMatchObject({ ok: true });

      expect(await leave(socket, second.id)).toEqual({ ok: true });
      expect(await join(socket, { workspaceId, reviewNumber: third.number })).toMatchObject({
        ok: true,
      });
    });
  });

  describe('emitToReview', () => {
    it('reaches only the sockets in that review room', async () => {
      const other = await createReview(app, owner, workspaceId);
      const inRoom = await connect(url, { ticket: await getTicket(app, viewer) });
      const elsewhere = await connect(url, { ticket: await getTicket(app, viewer) });
      const left = await connect(url, { ticket: await getTicket(app, viewer) });
      const notJoined = await connect(url, { ticket: await getTicket(app, owner) });
      await join(inRoom, { workspaceId, reviewNumber });
      await join(elsewhere, { workspaceId, reviewNumber: other.number });
      await join(left, { workspaceId, reviewNumber });
      await leave(left, reviewId);

      const received = nextEvent(inRoom, 'test:event');
      const quiet = Promise.all(
        [elsewhere, left, notJoined].map((socket) => receivedWithin(socket, 'test:event', 500)),
      );
      app.realtime.emitToReview(reviewId, TEST_EVENT, { n: 1 } as never);

      expect(await received).toEqual({ n: 1 });
      expect(await quiet).toEqual([false, false, false]);
    });

    it('reaches a socket on another instance through Redis', async () => {
      const a = await startApp();
      const b = await startApp();
      const socket = await connect(a.url, { ticket: await getTicket(a.app, viewer) });
      expect(await join(socket, { workspaceId, reviewNumber })).toMatchObject({ ok: true });

      const received = nextEvent(socket, 'test:event', 5_000);
      // B's subscription may still be starting: emit until A's socket sees one.
      const timer = setInterval(
        () => b.app.realtime.emitToReview(reviewId, TEST_EVENT, { from: 'b' } as never),
        100,
      );
      try {
        expect(await received).toEqual({ from: 'b' });
      } finally {
        clearInterval(timer);
      }
    });
  });

  describe('shutdown', () => {
    it('drops sockets (so clients reconnect elsewhere) and closes every Redis connection', async () => {
      const instance = await startApp();
      const socket = await connect(instance.url, {
        ticket: await getTicket(instance.app, viewer),
      });
      const adapter = instance.app.realtime.io.of('/').adapter as RedisAdapter;
      const disconnected = nextEvent(socket, 'disconnect');

      await instance.app.close();
      openApps.delete(instance.app);

      // Not "io server disconnect": after that reason a client would not reconnect by itself.
      expect(await disconnected).toBe('transport close');
      expect(instance.app.redis.status).toBe('end');
      expect((adapter.pubClient as { status: string }).status).toBe('end');
      expect((adapter.subClient as { status: string }).status).toBe('end');
    });
  });
});
