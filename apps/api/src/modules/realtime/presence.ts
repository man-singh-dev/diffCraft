import { PRESENCE_MAX_VIEWERS, reviewRoom, type PresenceEvent } from '@diffcraft/shared';
import type { FastifyBaseLogger } from 'fastify';
import { safeError, type RealtimeServer, type RealtimeSocket } from './socket-server.js';

export interface PresenceOptions {
  coalesceMs: number;
  fetchTimeoutMs: number;
}

export const DEFAULT_PRESENCE_OPTIONS: PresenceOptions = { coalesceMs: 500, fetchTimeoutMs: 3_000 };

export interface Presence {
  changed(reviewId: string): void;
  sendTo(socket: RealtimeSocket, reviewId: string): Promise<void>;
  close(): void;
}

type ViewerData = { userId?: string; displayName?: string };

export function summarizeViewers(reviewId: string, sockets: { data: ViewerData }[]): PresenceEvent {
  const byId = new Map<string, string>();
  for (const { data } of sockets) {
    if (data.userId && !byId.has(data.userId)) byId.set(data.userId, data.displayName ?? '');
  }
  const viewers = [...byId]
    .map(([id, displayName]) => ({ id, displayName }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName) || (a.id < b.id ? -1 : 1));
  return { reviewId, viewers: viewers.slice(0, PRESENCE_MAX_VIEWERS), total: viewers.length };
}

export function createPresence(
  io: RealtimeServer,
  log: FastifyBaseLogger,
  { coalesceMs, fetchTimeoutMs }: PresenceOptions,
): Presence {
  const pending = new Map<string, NodeJS.Timeout>();
  let closed = false;

  async function compute(reviewId: string): Promise<PresenceEvent | null> {
    let timer: NodeJS.Timeout | undefined;
    try {
      // The adapter ignores timeout flags here, and its server count waits forever while Redis is down.
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('fetchSockets timed out')), fetchTimeoutMs);
      });
      const sockets = await Promise.race([io.in(reviewRoom(reviewId)).fetchSockets(), timeout]);
      return summarizeViewers(reviewId, sockets);
    } catch (err) {
      log.error({ err: safeError(err), reviewId }, 'presence recompute failed');
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    // Trailing timer: a burst of joins and leaves within the window becomes one emit with the final state.
    changed(reviewId) {
      if (closed || pending.has(reviewId)) return;
      const timer = setTimeout(async () => {
        pending.delete(reviewId);
        const event = await compute(reviewId);
        if (event && !closed) io.to(reviewRoom(reviewId)).emit('presence', event);
      }, coalesceMs);
      pending.set(reviewId, timer);
    },
    async sendTo(socket, reviewId) {
      const event = await compute(reviewId);
      if (event && !closed && socket.rooms.has(reviewRoom(reviewId)))
        socket.emit('presence', event);
    },
    close() {
      closed = true;
      for (const timer of pending.values()) clearTimeout(timer);
      pending.clear();
    },
  };
}
