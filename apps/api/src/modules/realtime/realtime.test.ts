import { randomBytes, randomUUID } from 'node:crypto';
import {
  ErrorResponseSchema,
  PresenceEventSchema,
  RealtimeTicketResponseSchema,
  type PresenceEvent,
} from '@diffcraft/shared';
import type { RedisAdapter } from '@socket.io/redis-adapter';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Socket as ClientSocket } from 'socket.io-client';
import { beforeAll, describe, expect, it } from 'vitest';
import { users } from '../../db/schema/index.js';
import { addMember, createUserWithSession, type TestUser } from '../../test/fixtures.js';
import {
  closeRealtimeResourcesAfterTests,
  connect,
  createReview,
  createWorkspace,
  forgetApp,
  getTicket,
  join,
  leave,
  nextEvent,
  receivedWithin,
  recordEvents,
  startApp,
  TICKET_URL,
} from '../../test/realtime.js';
import { describeWithDbAndRedis } from '../../test/redis.js';
import { ticketKey } from './ticket.js';

const TEST_EVENT = 'test:event' as never;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function presenceMatching(
  socket: ClientSocket,
  predicate: (event: PresenceEvent) => boolean,
  timeoutMs = 5_000,
): Promise<PresenceEvent> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off('presence', listener);
      reject(new Error(`no matching presence within ${timeoutMs} ms`));
    }, timeoutMs);
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

const names = (event: PresenceEvent) => event.viewers.map((v) => v.displayName);

closeRealtimeResourcesAfterTests();

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

  describe('presence', () => {
    async function member(displayName: string) {
      const user = await createUserWithSession(app.db);
      await app.db.update(users).set({ displayName }).where(eq(users.id, user.id));
      await addMember(app.db, workspaceId, user.id, 'viewer');
      return user;
    }

    const freshReview = () => createReview(app, owner, workspaceId);

    it('lists everyone in the room, sorted, for every viewer', async () => {
      const review = await freshReview();
      const ravi = await connect(url, { ticket: await getTicket(app, await member('Ravi')) });
      const asha = await connect(url, { ticket: await getTicket(app, await member('Asha')) });

      const raviAlone = presenceMatching(ravi, () => true);
      await join(ravi, { workspaceId, reviewNumber: review.number });
      expect(await raviAlone).toMatchObject({ reviewId: review.id, total: 1 });

      const bothForRavi = presenceMatching(ravi, (e) => e.total === 2);
      const bothForAsha = presenceMatching(asha, (e) => e.total === 2);
      await join(asha, { workspaceId, reviewNumber: review.number });
      expect(names(await bothForRavi)).toEqual(['Asha', 'Ravi']);
      expect(names(await bothForAsha)).toEqual(['Asha', 'Ravi']);
    });

    it('counts a user with two tabs once', async () => {
      const review = await freshReview();
      const user = await member('Mira');
      const first = await connect(url, { ticket: await getTicket(app, user) });
      const second = await connect(url, { ticket: await getTicket(app, user) });
      await join(first, { workspaceId, reviewNumber: review.number });

      const sentToSecond = presenceMatching(second, () => true);
      await join(second, { workspaceId, reviewNumber: review.number });
      expect(await sentToSecond).toEqual({
        reviewId: review.id,
        viewers: [{ id: user.id, displayName: 'Mira' }],
        total: 1,
      });
    });

    it('updates the list after a leave and after a disconnect', async () => {
      const review = await freshReview();
      const ada = await connect(url, { ticket: await getTicket(app, await member('Ada')) });
      const ben = await connect(url, { ticket: await getTicket(app, await member('Ben')) });
      const cy = await connect(url, { ticket: await getTicket(app, await member('Cy')) });
      const all = presenceMatching(ada, (e) => e.total === 3);
      for (const socket of [ada, ben, cy]) {
        await join(socket, { workspaceId, reviewNumber: review.number });
      }
      await all;

      const afterLeave = presenceMatching(ada, (e) => e.total === 2);
      await leave(ben, review.id);
      expect(names(await afterLeave)).toEqual(['Ada', 'Cy']);

      const afterDisconnect = presenceMatching(ada, (e) => e.total === 1);
      cy.disconnect();
      expect(names(await afterDisconnect)).toEqual(['Ada']);
    });

    it('coalesces a burst of joins into one emit with the final state', async () => {
      const review = await freshReview();
      const observer = await connect(url, { ticket: await getTicket(app, await member('Obs')) });
      await join(observer, { workspaceId, reviewNumber: review.number });
      await sleep(800);

      const tickets = await Promise.all(
        ['B1', 'B2', 'B3', 'B4', 'B5'].map(async (name) => getTicket(app, await member(name))),
      );
      const sockets = await Promise.all(tickets.map((ticket) => connect(url, { ticket })));
      const recording = recordEvents(observer);
      await Promise.all(
        sockets.map((socket) => join(socket, { workspaceId, reviewNumber: review.number })),
      );
      await sleep(1_500);
      recording.stop();

      const presence = recording.events.filter((e) => e.event === 'presence');
      expect(presence).toHaveLength(1);
      expect(PresenceEventSchema.parse(presence[0]!.payload).total).toBe(6);
    });

    it('includes users connected to another instance', async () => {
      const a = await startApp();
      const b = await startApp();
      const review = await freshReview();
      const warmup = await freshReview();
      const onA = await connect(a.url, { ticket: await getTicket(a.app, await member('OnA')) });
      const onB = await connect(b.url, { ticket: await getTicket(b.app, await member('OnB')) });
      await join(onA, { workspaceId, reviewNumber: warmup.number });
      await join(onB, { workspaceId, reviewNumber: warmup.number });

      // Each instance's Redis subscription may still be starting: wait until both directions work.
      for (const [from, to] of [
        [b.app, onA],
        [a.app, onB],
      ] as const) {
        const received = nextEvent(to, 'test:event', 5_000);
        const timer = setInterval(
          () => from.realtime.emitToReview(warmup.id, TEST_EVENT, {} as never),
          100,
        );
        try {
          await received;
        } finally {
          clearInterval(timer);
        }
      }

      const bothOnA = presenceMatching(onA, (e) => e.reviewId === review.id && e.total === 2);
      const bothOnB = presenceMatching(onB, (e) => e.reviewId === review.id && e.total === 2);
      await join(onA, { workspaceId, reviewNumber: review.number });
      await join(onB, { workspaceId, reviewNumber: review.number });
      expect(names(await bothOnA)).toEqual(['OnA', 'OnB']);
      expect(names(await bothOnB)).toEqual(['OnA', 'OnB']);
    });

    it('never sends presence to a socket that is not in the room', async () => {
      const review = await freshReview();
      const stranger = await connect(url, { ticket: await getTicket(app, outsider) });
      expect(await join(stranger, { workspaceId, reviewNumber: review.number })).toMatchObject({
        ok: false,
      });
      expect(await leave(stranger, review.id)).toEqual({ ok: true });

      const quiet = receivedWithin(stranger, 'presence', 1_500);
      const insider = await connect(url, { ticket: await getTicket(app, await member('In')) });
      await join(insider, { workspaceId, reviewNumber: review.number });
      expect(await quiet).toBe(false);
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
      forgetApp(instance.app);

      // Not "io server disconnect": after that reason a client would not reconnect by itself.
      expect(await disconnected).toBe('transport close');
      expect(instance.app.redis.status).toBe('end');
      expect((adapter.pubClient as { status: string }).status).toBe('end');
      expect((adapter.subClient as { status: string }).status).toBe('end');
    });
  });
});
