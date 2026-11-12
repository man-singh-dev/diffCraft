import fp from 'fastify-plugin';
import type { Config } from '../../config.js';
import { safeError } from '../realtime/socket-server.js';
import { createAnalysisPublisher, type AnalysisPublisher } from './events.js';
import { PROMPT_VERSION } from './prompt.js';
import { createFakeProvider } from './providers/fake.js';
import { createOpenAICompatibleProvider } from './providers/openai-compatible.js';
import type { AiProvider } from './providers/types.js';
import { createBullQueue, startBullWorker, type AnalysisQueue } from './queue.js';
import { processAnalysisJob, startSweeper } from './worker.js';

export interface Ai {
  enabled: boolean;
  model: string;
  promptVersion: string;
  dailyLimit: number;
  publisher: AnalysisPublisher;
  // Never throws: a job that fails to enqueue is picked up by the sweeper.
  enqueue(jobId: string): Promise<void>;
}

declare module 'fastify' {
  interface FastifyInstance {
    ai: Ai;
  }
}

export interface AiPluginOptions {
  config: Config;
  queue?: AnalysisQueue;
  provider?: AiProvider | null;
  worker?: boolean;
}

export function providerFromConfig(config: Config): AiProvider | null {
  switch (config.AI_PROVIDER) {
    case 'disabled':
      return null;
    case 'fake':
      return createFakeProvider();
    case 'openai_compatible':
      return createOpenAICompatibleProvider({
        baseURL: config.AI_BASE_URL!,
        apiKey: config.AI_API_KEY!,
        model: config.AI_MODEL!,
        maxOutputTokens: config.AI_MAX_OUTPUT_TOKENS,
        timeoutMs: config.AI_TIMEOUT_MS,
      });
  }
}

export const aiPlugin = fp<AiPluginOptions>(
  async (app, options) => {
    const { config } = options;
    const provider = options.provider === undefined ? providerFromConfig(config) : options.provider;
    const log = app.log.child({ module: 'ai' });
    const queue = options.queue ?? createBullQueue(config.REDIS_URL, log);
    // app.realtime is read on each emit: the realtime plugin registers after this one.
    const publisher = createAnalysisPublisher({
      db: app.db,
      log,
      emit: (reviewId, event, payload) => app.realtime.emitToReview(reviewId, event, payload),
    });

    app.decorate('ai', {
      enabled: provider !== null,
      model: provider?.model ?? 'none',
      promptVersion: PROMPT_VERSION,
      dailyLimit: config.AI_MAX_JOBS_PER_WORKSPACE_PER_DAY,
      publisher,
      async enqueue(jobId) {
        try {
          await queue.enqueue(jobId);
        } catch (err) {
          log.error({ err: safeError(err), jobId }, 'analysis enqueue failed');
        }
      },
    } satisfies Ai);

    let worker: { close(): Promise<void> } | undefined;
    let sweeper: { stop(): Promise<void> } | undefined;
    // Like the outbox relay, only a listening server works jobs; apps used through inject() never do.
    if (provider && options.worker !== false) {
      app.addHook('onListen', async () => {
        worker = startBullWorker({
          redisUrl: config.REDIS_URL,
          log,
          concurrency: config.AI_WORKER_CONCURRENCY,
          process: (jobId) => processAnalysisJob({ db: app.db, provider, log, publisher }, jobId),
        });
        sweeper = startSweeper({ db: app.db, queue, publisher, log });
      });
    }
    app.addHook('preClose', async () => {
      await sweeper?.stop();
      await worker?.close();
      await queue.close();
    });
  },
  { name: 'ai', dependencies: ['db'] },
);
