import type { Notification } from '@diffcraft/shared';
import { asc, inArray, isNull, lt, sql } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import { z } from 'zod';
import { outboxEvents } from '../../db/schema/index.js';
import type { Database } from '../../plugins/db.js';
import { safeError } from '../realtime/socket-server.js';
import { loadForDelivery, NOTIFICATION_TOPIC } from './service.js';

export interface RelayOptions {
  intervalMs: number;
  batchSize: number;
  maxAttempts: number;
  retentionMs: number;
  cleanupEveryMs: number;
  cleanupBatchSize: number;
}

export const DEFAULT_RELAY_OPTIONS: RelayOptions = {
  intervalMs: 1_000,
  batchSize: 100,
  maxAttempts: 10,
  retentionMs: 7 * 24 * 60 * 60 * 1_000,
  cleanupEveryMs: 60 * 60 * 1_000,
  cleanupBatchSize: 1_000,
};

export interface RelayDeps {
  db: Database;
  log: FastifyBaseLogger;
  emit: (userId: string, notification: Notification) => void | Promise<void>;
  canDeliver: () => boolean;
}

export interface TickResult {
  delivered: number;
  skipped: number;
  retried: number;
  gaveUp: number;
}

export interface Relay {
  tick(): Promise<TickResult>;
  cleanup(): Promise<number>;
  start(): void;
  stop(): Promise<void>;
}

const NotificationPayloadSchema = z.object({ userId: z.uuid(), notificationId: z.uuid() });

const MAX_CLEANUP_BATCHES = 10;

export function createRelay(deps: RelayDeps, options: RelayOptions): Relay {
  const { db, log, emit } = deps;
  let timer: NodeJS.Timeout | undefined;
  let running: Promise<void> | undefined;
  let started = false;
  let lastCleanup = 0;

  async function tick(): Promise<TickResult> {
    const result: TickResult = { delivered: 0, skipped: 0, retried: 0, gaveUp: 0 };
    await db.transaction(async (tx) => {
      // SKIP LOCKED: relays on other instances take the next rows instead of waiting for these.
      const rows = await tx
        .select()
        .from(outboxEvents)
        .where(isNull(outboxEvents.publishedAt))
        .orderBy(asc(outboxEvents.id))
        .limit(options.batchSize)
        .for('update', { skipLocked: true });
      if (rows.length === 0) return;

      const payloads = new Map(
        rows.flatMap((row) => {
          const parsed =
            row.topic === NOTIFICATION_TOPIC
              ? NotificationPayloadSchema.safeParse(row.payload)
              : null;
          return parsed?.success ? [[row.id, parsed.data] as const] : [];
        }),
      );
      const loaded = await loadForDelivery(
        tx,
        [...payloads.values()].map((p) => p.notificationId),
      );

      const published: string[] = [];
      const failed: string[] = [];
      const exhausted: string[] = [];
      for (const row of rows) {
        const payload = payloads.get(row.id);
        if (!payload) log.warn({ outboxId: row.id, topic: row.topic }, 'outbox event dropped');
        const target = payload && loaded.get(payload.notificationId);
        // Deleted since (review or thread gone) or the recipient left the workspace: nothing to deliver.
        if (!target || target.userId !== payload.userId) {
          published.push(row.id);
          result.skipped += 1;
          continue;
        }
        try {
          await emit(target.userId, target.notification);
          published.push(row.id);
          result.delivered += 1;
        } catch (err) {
          if (row.attempts + 1 >= options.maxAttempts) {
            log.error(
              { err: safeError(err), outboxId: row.id, attempts: row.attempts + 1 },
              'outbox event given up',
            );
            exhausted.push(row.id);
            result.gaveUp += 1;
          } else {
            failed.push(row.id);
            result.retried += 1;
          }
        }
      }

      if (published.length > 0) {
        await tx
          .update(outboxEvents)
          .set({ publishedAt: sql`now()` })
          .where(inArray(outboxEvents.id, published));
      }
      if (failed.length > 0) {
        await tx
          .update(outboxEvents)
          .set({ attempts: sql`${outboxEvents.attempts} + 1` })
          .where(inArray(outboxEvents.id, failed));
      }
      if (exhausted.length > 0) {
        await tx
          .update(outboxEvents)
          .set({ attempts: sql`${outboxEvents.attempts} + 1`, publishedAt: sql`now()` })
          .where(inArray(outboxEvents.id, exhausted));
      }
    });
    return result;
  }

  async function cleanup(): Promise<number> {
    let deleted = 0;
    for (let batch = 0; batch < MAX_CLEANUP_BATCHES; batch++) {
      const old = db
        .select({ id: outboxEvents.id })
        .from(outboxEvents)
        .where(
          lt(
            outboxEvents.publishedAt,
            sql`now() - ${options.retentionMs} * interval '1 millisecond'`,
          ),
        )
        .limit(options.cleanupBatchSize);
      const { rowCount } = await db.delete(outboxEvents).where(inArray(outboxEvents.id, old));
      deleted += rowCount ?? 0;
      if ((rowCount ?? 0) < options.cleanupBatchSize) break;
    }
    return deleted;
  }

  async function runOnce() {
    try {
      // While Redis is unreachable, emits would reach this instance's sockets only: wait rather than mark rows published.
      if (deps.canDeliver()) await tick();
      if (Date.now() - lastCleanup >= options.cleanupEveryMs) {
        lastCleanup = Date.now();
        await cleanup();
      }
    } catch (err) {
      log.error({ err: safeError(err) }, 'outbox relay tick failed');
    }
  }

  // setTimeout after each run, not setInterval: a slow tick never overlaps the next one.
  function schedule() {
    timer = setTimeout(() => {
      running = runOnce().finally(() => {
        running = undefined;
        if (started) schedule();
      });
    }, options.intervalMs);
  }

  return {
    tick,
    cleanup,
    start() {
      if (started) return;
      started = true;
      schedule();
    },
    async stop() {
      started = false;
      clearTimeout(timer);
      await running;
    },
  };
}
