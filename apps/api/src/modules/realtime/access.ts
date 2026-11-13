import {
  AccessRevokedReasonSchema,
  reviewRoom,
  userRoom,
  type AccessRevokedReason,
} from '@diffcraft/shared';
import { and, eq, gt, sql } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import { z } from 'zod';
import { sessions } from '../../db/schema/index.js';
import type { Database } from '../../plugins/db.js';
import type { Presence } from './presence.js';
import { safeError, type RealtimeServer, type RealtimeSocket } from './socket-server.js';

export interface AccessOptions {
  recheckIntervalMs: number;
  revokeTimeoutMs: number;
}

export const DEFAULT_ACCESS_OPTIONS: AccessOptions = {
  recheckIntervalMs: 5 * 60_000,
  revokeTimeoutMs: 5_000,
};

const WorkspaceRevocationSchema = z.object({
  userIds: z.array(z.uuid()),
  workspaceId: z.uuid(),
  reason: AccessRevokedReasonSchema,
});
type WorkspaceRevocation = z.infer<typeof WorkspaceRevocationSchema>;

const SessionRevocationSchema = z.object({
  userId: z.uuid(),
  sessionIds: z.array(z.string()),
});
type SessionRevocation = z.infer<typeof SessionRevocationSchema>;

type Ack = (done: boolean) => void;

export interface InterServerEvents {
  'access:revoke-workspace': (request: WorkspaceRevocation, ack: Ack) => void;
  'access:revoke-sessions': (request: SessionRevocation, ack: Ack) => void;
}

export interface AccessCheckResult {
  evicted: number;
  disconnected: number;
}

export interface AccessControl {
  revokeWorkspaceAccess(
    userIds: string[],
    workspaceId: string,
    reason: AccessRevokedReason,
  ): Promise<void>;
  revokeSessions(userId: string, sessionIds: string[]): Promise<void>;
  confirmSession(socket: RealtimeSocket): Promise<void>;
  checkLocalSockets(): Promise<AccessCheckResult>;
  startRechecks(): void;
  stop(): Promise<void>;
}

const accessKey = (userId: string, workspaceId: string) => `${userId}:${workspaceId}`;

export function createAccessControl({
  io,
  db,
  log,
  presence,
  options,
  clusterJoined,
}: {
  io: RealtimeServer;
  db: Database;
  log: FastifyBaseLogger;
  presence: Presence;
  options: AccessOptions;
  clusterJoined: () => boolean;
}): AccessControl {
  function localSocketsOf(userId: string): RealtimeSocket[] {
    const ids = io.sockets.adapter.rooms.get(userRoom(userId));
    if (!ids) return [];
    return [...ids].flatMap((id) => {
      const socket = io.sockets.sockets.get(id);
      return socket ? [socket] : [];
    });
  }

  function evict(socket: RealtimeSocket, reviewId: string, reason: AccessRevokedReason): boolean {
    delete socket.data.reviewRooms[reviewId];
    const room = reviewRoom(reviewId);
    if (!socket.rooms.has(room)) return false;
    void socket.leave(room);
    socket.emit('review:access-revoked', { reviewId, reason });
    return true;
  }

  function revokeWorkspaceLocally({ userIds, workspaceId, reason }: WorkspaceRevocation) {
    const affected = new Set<string>();
    for (const userId of userIds) {
      for (const socket of localSocketsOf(userId)) {
        for (const [reviewId, owner] of Object.entries(socket.data.reviewRooms)) {
          if (owner === workspaceId && evict(socket, reviewId, reason)) affected.add(reviewId);
        }
      }
    }
    for (const reviewId of affected) presence.changed(reviewId);
  }

  function revokeSessionsLocally({ userId, sessionIds }: SessionRevocation) {
    for (const socket of localSocketsOf(userId)) {
      if (sessionIds.includes(socket.data.sessionId)) socket.disconnect(true);
    }
  }

  io.on('access:revoke-workspace', (request, ack) => {
    try {
      const parsed = WorkspaceRevocationSchema.safeParse(request);
      if (parsed.success) revokeWorkspaceLocally(parsed.data);
    } finally {
      if (typeof ack === 'function') ack(true);
    }
  });

  io.on('access:revoke-sessions', (request, ack) => {
    try {
      const parsed = SessionRevocationSchema.safeParse(request);
      if (parsed.success) revokeSessionsLocally(parsed.data);
    } finally {
      if (typeof ack === 'function') ack(true);
    }
  });

  // Acknowledged by every other instance, unlike a remote socket's leave(): once this resolves, no instance
  // still delivers room events to the evicted sockets.
  async function onOtherInstances(event: string, send: () => Promise<boolean[]>) {
    if (!clusterJoined()) return;
    const acked = send();
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`timed out after ${options.revokeTimeoutMs} ms`)),
        options.revokeTimeoutMs,
      );
    });
    try {
      await Promise.race([acked, timeout]);
    } catch (err) {
      acked.catch(() => {});
      log.warn({ err: safeError(err), event }, 'access revocation did not reach every instance');
    } finally {
      clearTimeout(timer);
    }
  }

  async function sessionActive(sessionId: string): Promise<boolean> {
    const [row] = await db
      .select({ id: sessions.id })
      .from(sessions)
      .where(and(eq(sessions.id, sessionId), gt(sessions.expiresAt, sql`now()`)));
    return row !== undefined;
  }

  async function loadAccess(
    memberships: { user_id: string; workspace_id: string }[],
    sessionIds: string[],
  ) {
    const { rows } = await db.execute<{ kind: 'member' | 'session'; key: string }>(sql`
      select 'member' as kind, m.user_id::text || ':' || m.workspace_id::text as key
      from workspace_members m
      join jsonb_to_recordset(${JSON.stringify(memberships)}::jsonb)
        as p(user_id uuid, workspace_id uuid)
        on m.user_id = p.user_id and m.workspace_id = p.workspace_id
      union all
      select 'session' as kind, s.id as key
      from sessions s
      where s.id in (select jsonb_array_elements_text(${JSON.stringify(sessionIds)}::jsonb))
        and s.expires_at > now()
    `);
    const members = new Set<string>();
    const activeSessions = new Set<string>();
    for (const row of rows) (row.kind === 'member' ? members : activeSessions).add(row.key);
    return { members, activeSessions };
  }

  async function checkLocalSockets(): Promise<AccessCheckResult> {
    const result: AccessCheckResult = { evicted: 0, disconnected: 0 };
    const sockets = [...io.sockets.sockets.values()];
    if (sockets.length === 0) return result;

    const checked = new Map<string, { user_id: string; workspace_id: string }>();
    const sessionIds = new Set<string>();
    for (const socket of sockets) {
      sessionIds.add(socket.data.sessionId);
      for (const [reviewId, workspaceId] of Object.entries(socket.data.reviewRooms)) {
        if (!socket.rooms.has(reviewRoom(reviewId))) {
          delete socket.data.reviewRooms[reviewId];
          continue;
        }
        const { userId } = socket.data;
        checked.set(accessKey(userId, workspaceId), { user_id: userId, workspace_id: workspaceId });
      }
    }

    const granted = await loadAccess([...checked.values()], [...sessionIds]);
    const affected = new Set<string>();
    for (const socket of sockets) {
      if (socket.disconnected) continue;
      if (!granted.activeSessions.has(socket.data.sessionId)) {
        socket.disconnect(true);
        result.disconnected += 1;
        continue;
      }
      for (const [reviewId, workspaceId] of Object.entries(socket.data.reviewRooms)) {
        const key = accessKey(socket.data.userId, workspaceId);
        // A room joined while the query ran wasn't in it; its own join already checked membership.
        if (!checked.has(key) || granted.members.has(key)) continue;
        if (evict(socket, reviewId, 'removed')) {
          result.evicted += 1;
          affected.add(reviewId);
        }
      }
    }
    for (const reviewId of affected) presence.changed(reviewId);
    return result;
  }

  let timer: NodeJS.Timeout | undefined;
  let running: Promise<void> | undefined;
  let stopped = false;

  function schedule() {
    if (stopped) return;
    timer = setTimeout(() => {
      running = checkLocalSockets()
        .then(
          () => undefined,
          (err: unknown) => log.error({ err: safeError(err) }, 'realtime access check failed'),
        )
        .finally(() => {
          running = undefined;
          schedule();
        });
    }, options.recheckIntervalMs);
  }

  return {
    async revokeWorkspaceAccess(userIds, workspaceId, reason) {
      if (userIds.length === 0) return;
      const request = { userIds, workspaceId, reason };
      revokeWorkspaceLocally(request);
      await onOtherInstances('access:revoke-workspace', () =>
        io.serverSideEmitWithAck('access:revoke-workspace', request),
      );
    },
    async revokeSessions(userId, sessionIds) {
      if (sessionIds.length === 0) return;
      const request = { userId, sessionIds };
      revokeSessionsLocally(request);
      await onOtherInstances('access:revoke-sessions', () =>
        io.serverSideEmitWithAck('access:revoke-sessions', request),
      );
    },
    async confirmSession(socket) {
      try {
        if (!(await sessionActive(socket.data.sessionId))) socket.disconnect(true);
      } catch (err) {
        log.error({ err: safeError(err) }, 'realtime session check failed');
      }
    },
    checkLocalSockets,
    startRechecks: schedule,
    async stop() {
      stopped = true;
      clearTimeout(timer);
      await running;
    },
  };
}
