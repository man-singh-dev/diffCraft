import {
  hasAtLeastRole,
  REALTIME_PATH,
  ReviewJoinRequestSchema,
  ReviewLeaveRequestSchema,
  reviewRoom,
  type ClientToServerEvents,
  type ReviewJoinAck,
  type ReviewRoomEvents,
  type ServerToClientEvents,
} from '@diffcraft/shared';
import { createAdapter } from '@socket.io/redis-adapter';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import type { Redis } from 'ioredis';
import { Server, type Socket } from 'socket.io';
import { users } from '../../db/schema/index.js';
import { closeRedisClient, createRedisClient } from '../../plugins/redis.js';
import { getReviewByNumber } from '../reviews/service.js';
import { getMembership } from '../workspaces/service.js';
import { createPresence, DEFAULT_PRESENCE_OPTIONS, type Presence } from './presence.js';
import { consumeTicket } from './ticket.js';

export interface SocketData {
  userId: string;
  displayName: string;
  joinTimes: number[];
}

export type RealtimeServer = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>;
export type RealtimeSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>;

export interface RealtimeLimits {
  maxRoomsPerSocket: number;
  maxJoins: number;
  joinWindowMs: number;
}

export const DEFAULT_REALTIME_LIMITS: RealtimeLimits = {
  maxRoomsPerSocket: 20,
  maxJoins: 10,
  joinWindowMs: 10_000,
};

export interface Realtime {
  io: RealtimeServer;
  emitToReview<E extends keyof ReviewRoomEvents>(
    reviewId: string,
    event: E,
    payload: ReviewRoomEvents[E],
  ): void;
}

declare module 'fastify' {
  interface FastifyInstance {
    realtime: Realtime;
  }
}

export interface RealtimePluginOptions {
  webOrigin: string;
  redisUrl: string;
  limits?: Partial<RealtimeLimits>;
}

export const safeError = (err: unknown) =>
  err instanceof Error ? { name: err.name, message: err.message } : { message: String(err) };

export const realtimePlugin = fp<RealtimePluginOptions>(
  async (app, { webOrigin, redisUrl, limits: limitOverrides }) => {
    const limits = { ...DEFAULT_REALTIME_LIMITS, ...limitOverrides };
    const allowedOrigin = new URL(webOrigin).origin;

    const io: RealtimeServer = new Server(app.server, {
      path: REALTIME_PATH,
      serveClient: false,
      // WebSocket only: long polling spreads one session over many requests, which needs sticky sessions across instances.
      transports: ['websocket'],
      cors: { origin: allowedOrigin, credentials: false },
      // Browsers don't apply CORS to WebSocket upgrades, so the Origin is checked here.
      allowRequest: (req, callback) => callback(null, req.headers.origin === allowedOrigin),
      maxHttpBufferSize: 16 * 1024,
    });

    io.use(async (socket, next) => {
      try {
        const auth: unknown = socket.handshake.auth;
        const ticket =
          typeof auth === 'object' && auth !== null && 'ticket' in auth ? auth.ticket : null;
        const userId = await consumeTicket(app.redis, ticket);
        const user = userId ? await findUser(app, userId) : undefined;
        if (!user) {
          next(new Error('unauthorized'));
          return;
        }
        socket.data.userId = user.id;
        socket.data.displayName = user.displayName;
        socket.data.joinTimes = [];
        next();
      } catch (err) {
        app.log.error({ err: safeError(err) }, 'realtime handshake failed');
        next(new Error('unauthorized'));
      }
    });

    const presence = createPresence(io, app.log, DEFAULT_PRESENCE_OPTIONS);
    io.on('connection', (socket) => registerReviewRooms(app, socket, limits, presence));

    let pub: Redis | undefined;
    let sub: Redis | undefined;

    // Only a listening server joins the cluster; apps used through inject() never connect these.
    app.addHook('onListen', async () => {
      // No retry limit: the adapter doesn't handle rejected publish/subscribe calls, so they must wait for a reconnect.
      const options = { maxRetriesPerRequest: null, lazyConnect: false };
      pub = createRedisClient(redisUrl, app.log, 'pub', options);
      sub = createRedisClient(redisUrl, app.log, 'sub', options);
      io.adapter(createAdapter(pub, sub));
    });

    app.addHook('preClose', async () => {
      presence.close();
      await io.close();
    });

    app.addHook('onClose', async () => {
      await Promise.all([pub, sub].map((client) => client && closeRedisClient(client)));
    });

    app.decorate('realtime', {
      io,
      emitToReview(reviewId, event, payload) {
        const room = reviewRoom(reviewId);
        // At-most-once: while Redis is down, only this instance's sockets get the event (clients resync on reconnect).
        const target = pub && pub.status !== 'ready' ? io.local.to(room) : io.to(room);
        (target.emit as (event: string, payload: unknown) => boolean)(event, payload);
      },
    } satisfies Realtime);
  },
  { name: 'realtime', dependencies: ['db', 'redis'] },
);

async function findUser(app: FastifyInstance, userId: string) {
  const [row] = await app.db
    .select({ id: users.id, displayName: users.displayName })
    .from(users)
    .where(eq(users.id, userId));
  return row;
}

function registerReviewRooms(
  app: FastifyInstance,
  socket: RealtimeSocket,
  limits: RealtimeLimits,
  presence: Presence,
) {
  const log = app.log.child({ userId: socket.data.userId });

  socket.on('review:join', async (request, ack) => {
    if (typeof ack !== 'function') return;
    try {
      const result = await joinReview(app, socket, limits, request);
      ack(result);
      if (result.ok) {
        presence.changed(result.reviewId);
        // After the ack, so the client already knows the review id when this arrives.
        await presence.sendTo(socket, result.reviewId);
      }
    } catch (err) {
      log.error({ err: safeError(err) }, 'review:join failed');
      ack({ ok: false, error: 'internal_error' });
    }
  });

  socket.on('review:leave', async (request, ack) => {
    if (typeof ack !== 'function') return;
    const parsed = ReviewLeaveRequestSchema.safeParse(request);
    if (!parsed.success) {
      ack({ ok: false, error: 'invalid_request' });
      return;
    }
    const room = reviewRoom(parsed.data.reviewId);
    // Only a member of the room may trigger a recompute for it.
    const wasInRoom = socket.rooms.has(room);
    await socket.leave(room);
    ack({ ok: true });
    if (wasInRoom) presence.changed(parsed.data.reviewId);
  });

  socket.on('disconnecting', () => {
    for (const room of socket.rooms) {
      if (room.startsWith(REVIEW_ROOM_PREFIX))
        presence.changed(room.slice(REVIEW_ROOM_PREFIX.length));
    }
  });
}

async function joinReview(
  app: FastifyInstance,
  socket: RealtimeSocket,
  limits: RealtimeLimits,
  request: unknown,
): Promise<ReviewJoinAck> {
  // Counted before validation, so malformed requests can't be used to probe without limit.
  const now = Date.now();
  const recent = socket.data.joinTimes.filter((time) => time > now - limits.joinWindowMs);
  if (recent.length >= limits.maxJoins) {
    socket.data.joinTimes = recent;
    return { ok: false, error: 'rate_limited' };
  }
  socket.data.joinTimes = [...recent, now];

  const parsed = ReviewJoinRequestSchema.safeParse(request);
  if (!parsed.success) return { ok: false, error: 'invalid_request' };
  const { workspaceId, reviewNumber } = parsed.data;

  // Not a member and no such review get the same answer, so ids can't be probed for existence.
  const role = await getMembership(app.db, workspaceId, socket.data.userId);
  if (!role || !hasAtLeastRole(role, 'viewer')) return { ok: false, error: 'not_found' };
  const review = await getReviewByNumber(app.db, workspaceId, reviewNumber);
  if (!review) return { ok: false, error: 'not_found' };

  const room = reviewRoom(review.id);
  // No await between this check and join(), so concurrent joins can't pass the cap together.
  if (!socket.rooms.has(room) && reviewRoomCount(socket) >= limits.maxRoomsPerSocket) {
    return { ok: false, error: 'too_many_rooms' };
  }
  if (socket.disconnected) return { ok: false, error: 'not_found' };
  await socket.join(room);
  return { ok: true, reviewId: review.id };
}

const REVIEW_ROOM_PREFIX = reviewRoom('');

const reviewRoomCount = (socket: RealtimeSocket) =>
  [...socket.rooms].filter((room) => room.startsWith(REVIEW_ROOM_PREFIX)).length;
