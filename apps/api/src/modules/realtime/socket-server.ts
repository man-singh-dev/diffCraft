import {
  hasAtLeastRole,
  REALTIME_PATH,
  ReviewJoinRequestSchema,
  ReviewLeaveRequestSchema,
  reviewRoom,
  userRoom,
  type ClientToServerEvents,
  type ReviewJoinAck,
  type AccessRevokedReason,
  type ReviewRoomEvents,
  type ServerToClientEvents,
  type UserEvents,
} from '@diffcraft/shared';
import { createAdapter } from '@socket.io/redis-adapter';
import { and, eq, gt, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import type { Redis } from 'ioredis';
import { Server, type Socket } from 'socket.io';
import { sessions, users } from '../../db/schema/index.js';
import { closeRedisClient, createRedisClient } from '../../plugins/redis.js';
import { getReviewByNumber } from '../reviews/service.js';
import { getMembership } from '../workspaces/service.js';
import {
  createAccessControl,
  DEFAULT_ACCESS_OPTIONS,
  type AccessCheckResult,
  type AccessOptions,
  type InterServerEvents,
} from './access.js';
import { createPresence, DEFAULT_PRESENCE_OPTIONS, type Presence } from './presence.js';
import { consumeTicket, type TicketClaims } from './ticket.js';

// Sent to other instances by fetchSockets(): keep it small and JSON-serializable.
export interface SocketData {
  userId: string;
  displayName: string;
  sessionId: string;
  joinTimes: number[];
  /** reviewId → workspaceId of each review room this socket joined. */
  reviewRooms: Record<string, string>;
}

export type RealtimeServer = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;
export type RealtimeSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
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
  emitToUser<E extends keyof UserEvents>(userId: string, event: E, payload: UserEvents[E]): void;
  canReachAllInstances(): boolean;
  /** After the commit that ended the membership: evicts those users' sockets from the workspace's review rooms. */
  revokeWorkspaceAccess(
    userIds: string[],
    workspaceId: string,
    reason: AccessRevokedReason,
  ): Promise<void>;
  /** After the sessions were deleted: disconnects the sockets authenticated with them. */
  revokeSessions(userId: string, sessionIds: string[]): Promise<void>;
  checkLocalSockets(): Promise<AccessCheckResult>;
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
  access?: Partial<AccessOptions>;
}

export const safeError = (err: unknown) =>
  err instanceof Error ? { name: err.name, message: err.message } : { message: String(err) };

export const realtimePlugin = fp<RealtimePluginOptions>(
  async (app, { webOrigin, redisUrl, limits: limitOverrides, access: accessOverrides }) => {
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
        const claims = await consumeTicket(app.redis, ticket);
        const user = claims ? await findSessionUser(app, claims) : undefined;
        if (!claims || !user) {
          next(new Error('unauthorized'));
          return;
        }
        socket.data.userId = user.id;
        socket.data.displayName = user.displayName;
        socket.data.sessionId = claims.sessionId;
        socket.data.joinTimes = [];
        socket.data.reviewRooms = {};
        next();
      } catch (err) {
        app.log.error({ err: safeError(err) }, 'realtime handshake failed');
        next(new Error('unauthorized'));
      }
    });

    let pub: Redis | undefined;
    let sub: Redis | undefined;

    const presence = createPresence(io, app.log, DEFAULT_PRESENCE_OPTIONS);
    const access = createAccessControl({
      io,
      db: app.db,
      log: app.log,
      presence,
      options: { ...DEFAULT_ACCESS_OPTIONS, ...accessOverrides },
      clusterJoined: () => pub !== undefined,
    });
    io.on('connection', (socket) => {
      void socket.join(userRoom(socket.data.userId));
      registerReviewRooms(app, socket, limits, presence);
      // After joining the user room: a logout committed after the handshake's check is seen here or reaches this socket.
      void access.confirmSession(socket);
    });

    // Only a listening server joins the cluster; apps used through inject() never connect these.
    app.addHook('onListen', async () => {
      // No retry limit: the adapter doesn't handle rejected publish/subscribe calls, so they must wait for a reconnect.
      const options = { maxRetriesPerRequest: null, lazyConnect: false };
      pub = createRedisClient(redisUrl, app.log, 'pub', options);
      sub = createRedisClient(redisUrl, app.log, 'sub', options);
      io.adapter(createAdapter(pub, sub));
      access.startRechecks();
    });

    app.addHook('preClose', async () => {
      await access.stop();
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
      emitToUser(userId, event, payload) {
        (io.to(userRoom(userId)).emit as (event: string, payload: unknown) => boolean)(
          event,
          payload,
        );
      },
      canReachAllInstances: () => !pub || pub.status === 'ready',
      revokeWorkspaceAccess: access.revokeWorkspaceAccess,
      revokeSessions: access.revokeSessions,
      checkLocalSockets: access.checkLocalSockets,
    } satisfies Realtime);
  },
  { name: 'realtime', dependencies: ['db', 'redis'] },
);

async function findSessionUser(app: FastifyInstance, { userId, sessionId }: TicketClaims) {
  const [row] = await app.db
    .select({ id: users.id, displayName: users.displayName })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(
      and(
        eq(sessions.id, sessionId),
        eq(sessions.userId, userId),
        gt(sessions.expiresAt, sql`now()`),
      ),
    );
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
    delete socket.data.reviewRooms[parsed.data.reviewId];
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
  socket.data.reviewRooms[review.id] = review.workspaceId;
  await socket.join(room);

  // Checked again after joining: a removal committed during the checks above is seen here or evicts this socket.
  if (!(await getMembership(app.db, workspaceId, socket.data.userId))) {
    delete socket.data.reviewRooms[review.id];
    await socket.leave(room);
    return { ok: false, error: 'not_found' };
  }
  return { ok: true, reviewId: review.id };
}

const REVIEW_ROOM_PREFIX = reviewRoom('');

const reviewRoomCount = (socket: RealtimeSocket) =>
  [...socket.rooms].filter((room) => room.startsWith(REVIEW_ROOM_PREFIX)).length;
