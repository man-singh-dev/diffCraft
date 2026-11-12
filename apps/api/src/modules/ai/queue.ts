import { Queue, Worker, type Job } from 'bullmq';
import type { FastifyBaseLogger } from 'fastify';
import type { Redis } from 'ioredis';
import { closeRedisClient, createRedisClient } from '../../plugins/redis.js';
import { safeError } from '../realtime/socket-server.js';
import { MAX_ATTEMPTS, RetryLaterError } from './worker.js';

export const AI_QUEUE_NAME = 'ai-analysis';
const BACKOFF_TYPE = 'ai-retry';
const BASE_DELAY_MS = 5_000;
const MAX_DELAY_MS = 5 * 60_000;

export interface AnalysisQueue {
  enqueue(jobId: string): Promise<void>;
  close(): Promise<void>;
}

interface JobData {
  analysisJobId: string;
}

export function retryDelay(attemptsMade: number, err: unknown, random = Math.random): number {
  if (err instanceof RetryLaterError && err.retryAfterMs !== undefined) {
    return Math.min(Math.max(err.retryAfterMs, 1_000), MAX_DELAY_MS);
  }
  const exponential = BASE_DELAY_MS * 2 ** Math.max(0, attemptsMade - 1);
  return Math.round(Math.min(exponential, MAX_DELAY_MS) * (0.8 + random() * 0.4));
}

// BullMQ requires maxRetriesPerRequest: null; its connections are separate from the app's main Redis client.
function bullConnection(redisUrl: string, log: FastifyBaseLogger, name: string): Redis {
  return createRedisClient(redisUrl, log, name, { maxRetriesPerRequest: null, lazyConnect: false });
}

// Created on first use, so apps that never enqueue (most tests) never connect.
export function createBullQueue(redisUrl: string, log: FastifyBaseLogger): AnalysisQueue {
  let state: { queue: Queue<JobData>; connection: Redis } | undefined;
  const get = () => {
    if (!state) {
      const connection = bullConnection(redisUrl, log, 'ai-queue');
      const queue = new Queue<JobData>(AI_QUEUE_NAME, { connection });
      queue.on('error', (err) => log.error({ err: safeError(err) }, 'ai queue error'));
      state = { queue, connection };
    }
    return state.queue;
  };
  return {
    async enqueue(jobId) {
      await get().add(
        'analyze',
        { analysisJobId: jobId },
        {
          jobId,
          attempts: MAX_ATTEMPTS,
          backoff: { type: BACKOFF_TYPE },
          // The database row keeps the outcome; removing finished jobs also frees the id for the sweeper.
          removeOnComplete: true,
          removeOnFail: true,
        },
      );
    },
    async close() {
      if (!state) return;
      await state.queue.close();
      await closeRedisClient(state.connection);
      state = undefined;
    },
  };
}

export function startBullWorker(options: {
  redisUrl: string;
  log: FastifyBaseLogger;
  concurrency: number;
  process: (analysisJobId: string) => Promise<unknown>;
}): { close(): Promise<void> } {
  const connection = bullConnection(options.redisUrl, options.log, 'ai-worker');
  const worker = new Worker<JobData>(
    AI_QUEUE_NAME,
    async (job: Job<JobData>) => {
      await options.process(job.data.analysisJobId);
    },
    {
      connection,
      concurrency: options.concurrency,
      settings: { backoffStrategy: (attemptsMade, _type, err) => retryDelay(attemptsMade, err) },
    },
  );
  worker.on('error', (err) => options.log.error({ err: safeError(err) }, 'ai worker error'));
  return {
    async close() {
      // Waits for in-flight jobs; each is bounded by the provider timeout.
      await worker.close();
      await closeRedisClient(connection);
    },
  };
}
