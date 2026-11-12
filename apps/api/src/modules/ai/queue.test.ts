import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { describeWithDbAndRedis, testRedisUrl } from '../../test/redis.js';
import { createBullQueue, retryDelay, startBullWorker } from './queue.js';
import { RetryLaterError } from './worker.js';

describe('retryDelay', () => {
  const noJitter = () => 0.5;

  it('backs off exponentially with jitter', () => {
    expect(retryDelay(1, new RetryLaterError('provider_error'), noJitter)).toBe(5_000);
    expect(retryDelay(2, new RetryLaterError('provider_error'), noJitter)).toBe(10_000);
    expect(retryDelay(1, new Error('x'), () => 0)).toBe(4_000);
    expect(retryDelay(1, new Error('x'), () => 1)).toBe(6_000);
  });

  it("waits as long as the provider's Retry-After, within bounds", () => {
    expect(retryDelay(1, new RetryLaterError('provider_rate_limited', 30_000))).toBe(30_000);
    expect(retryDelay(1, new RetryLaterError('provider_rate_limited', 0))).toBe(1_000);
    expect(retryDelay(1, new RetryLaterError('provider_rate_limited', 60 * 60_000))).toBe(300_000);
  });
});

describeWithDbAndRedis('BullMQ queue and worker', () => {
  it('delivers each job id once, and retries after the Retry-After delay', async () => {
    const log = Fastify({ logger: false }).log;
    const queue = createBullQueue(testRedisUrl!, log);
    const calls: { id: string; at: number }[] = [];
    const retried = randomUUID();
    const plain = randomUUID();
    let done!: () => void;
    const finished = new Promise<void>((resolve) => (done = resolve));
    const worker = startBullWorker({
      redisUrl: testRedisUrl!,
      log,
      concurrency: 2,
      process: async (id) => {
        calls.push({ id, at: Date.now() });
        if (id === retried && calls.filter((c) => c.id === retried).length === 1) {
          throw new RetryLaterError('provider_rate_limited', 1_000);
        }
        if (calls.filter((c) => c.id === retried).length === 2) done();
      },
    });
    try {
      await queue.enqueue(retried);
      await queue.enqueue(retried);
      await queue.enqueue(plain);
      await finished;
      const retriedCalls = calls.filter((c) => c.id === retried);
      expect(retriedCalls).toHaveLength(2);
      expect(retriedCalls[1]!.at - retriedCalls[0]!.at).toBeGreaterThanOrEqual(900);
      expect(calls.filter((c) => c.id === plain)).toHaveLength(1);
    } finally {
      await worker.close();
      await queue.close();
    }
  }, 15_000);
});
