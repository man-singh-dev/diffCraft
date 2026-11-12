import {
  AnalysisCompletedEventSchema,
  AnalysisStatusEventSchema,
  type AiJob,
} from '@diffcraft/shared';
import { eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';
import { aiAnalysisJobs, aiFindings } from '../../db/schema/index.js';
import { describeWithDb, testDatabaseUrl } from '../../test/db.js';
import { createUserWithSession, type TestUser } from '../../test/fixtures.js';
import {
  closeRealtimeResourcesAfterTests,
  connectAs,
  join,
  nextEvent,
  startApp,
} from '../../test/realtime.js';
import { describeWithDbAndRedis } from '../../test/redis.js';
import { InvalidOutputError, ProviderError } from './errors.js';
import { createAnalysisPublisher } from './events.js';
import { createFakeProvider } from './providers/fake.js';
import type { AiProvider } from './providers/types.js';
import {
  FakeQueue,
  finding,
  ok,
  recordingPublisher,
  scriptedProvider,
  setupReview,
  startAnalysis,
} from './test-helpers.js';
import { processAnalysisJob, RetryLaterError, sweep } from './worker.js';

describeWithDb('analysis worker', () => {
  let app: FastifyInstance;
  let owner: TestUser;
  const queue = new FakeQueue();

  beforeAll(async () => {
    app = await buildApp(
      loadConfig({ LOG_LEVEL: 'silent', NODE_ENV: 'test', DATABASE_URL: testDatabaseUrl }),
      { ai: { queue, worker: false, provider: createFakeProvider() } },
    );
    owner = await createUserWithSession(app.db);
  });

  afterAll(async () => {
    await app.close();
  });

  async function newJob(): Promise<AiJob> {
    const { workspace, review } = await setupReview(app, owner);
    return startAnalysis(app, owner, workspace.id, review);
  }

  async function run(provider: AiProvider, job: AiJob, maxAttempts?: number) {
    const { publisher, events } = recordingPublisher(app);
    const outcome = await processAnalysisJob(
      { db: app.db, provider, log: app.log, publisher, ...(maxAttempts && { maxAttempts }) },
      job.id,
    ).catch((err: unknown) => err);
    const [row] = await app.db.select().from(aiAnalysisJobs).where(eq(aiAnalysisJobs.id, job.id));
    const findings = await app.db.select().from(aiFindings).where(eq(aiFindings.jobId, job.id));
    return { outcome, row: row!, findings, events };
  }

  it('stores mapped findings, token usage and the summary, and publishes the status changes', async () => {
    const job = await newJob();
    const provider = scriptedProvider(
      ok({
        summary: 'Changes b.',
        findings: [
          finding(),
          finding({ side: 'old', lineStart: 2, lineEnd: 2, category: 'performance' }),
          finding({ lineStart: 40, lineEnd: 41 }),
          finding({ file: 'pnpm-lock.yaml', lineStart: 1, lineEnd: 1 }),
        ],
      }),
    );
    const { outcome, row, findings, events } = await run(provider, job);

    expect(outcome).toBe('succeeded');
    expect(row).toMatchObject({
      status: 'succeeded',
      attempts: 1,
      errorCode: null,
      inputTokens: 100,
      outputTokens: 20,
      droppedFindings: 2,
    });
    expect(row.summary).toContain('Changes b.');
    expect(row.summary).toContain('Skipped files: 1 lockfile, 1 binary.');
    expect(row.startedAt).not.toBeNull();
    expect(row.finishedAt).not.toBeNull();
    expect(findings.map((f) => [f.side, f.lineStart, f.lineEnd, f.category])).toEqual(
      expect.arrayContaining([
        ['new', 2, 2, 'bug'],
        ['old', 2, 2, 'performance'],
      ]),
    );
    expect(findings).toHaveLength(2);
    expect(findings.every((f) => f.reviewId === job.reviewId && f.reviewFileId)).toBe(true);

    expect(events.map((e) => e.event)).toEqual([
      'analysis:status',
      'analysis:status',
      'analysis:completed',
    ]);
    const [running, succeeded, completed] = events;
    expect(AnalysisStatusEventSchema.parse(running!.payload).job.status).toBe('running');
    expect(AnalysisStatusEventSchema.parse(succeeded!.payload).job.status).toBe('succeeded');
    expect(AnalysisCompletedEventSchema.parse(completed!.payload)).toMatchObject({
      reviewId: job.reviewId,
      jobId: job.id,
      findings: 2,
    });
  });

  it('sends only analyzable files, redacted, inside the delimiters', async () => {
    const job = await newJob();
    const provider = scriptedProvider(ok({ summary: 'Fine.', findings: [] }));
    const { outcome, row } = await run(provider, job);
    expect(outcome).toBe('succeeded');
    expect(row.droppedFindings).toBe(0);

    const { user } = provider.calls[0]!.prompt;
    expect(user).toContain('FILE: src/app.ts (modified)');
    expect(user).toContain('new 3 + const apiKey = "[REDACTED]";');
    expect(user).not.toContain('super-secret-value');
    expect(user).not.toContain('pnpm-lock.yaml');
    expect(user).not.toContain('logo.png');
    expect(provider.calls[0]!.context.files.map((f) => f.path)).toEqual(['src/app.ts']);
  });

  it('repairs invalid output once, then succeeds', async () => {
    const job = await newJob();
    const provider = scriptedProvider(
      ok({ summary: 'x', findings: [finding({ severity: 'urgent' as never })] }),
      ok({ summary: 'Fixed.', findings: [finding()] }),
    );
    const { outcome, row, findings } = await run(provider, job);
    expect(outcome).toBe('succeeded');
    expect(provider.calls).toHaveLength(2);
    expect(provider.calls[1]!.repair?.problem).toMatch(/findings\.0\.severity/);
    expect(provider.calls[1]!.repair?.previousOutput).toContain('urgent');
    expect(row).toMatchObject({ inputTokens: 200, outputTokens: 40 });
    expect(findings).toHaveLength(1);
  });

  it('fails with invalid_output when the repair is invalid too, without retrying', async () => {
    const job = await newJob();
    const provider = scriptedProvider(
      new InvalidOutputError('not_json', 'nope', { inputTokens: 50, outputTokens: 5 }),
      ok({ summary: 42 }),
    );
    const { outcome, row, findings, events } = await run(provider, job);
    expect(outcome).toBe('failed');
    expect(row).toMatchObject({
      status: 'failed',
      errorCode: 'invalid_output',
      inputTokens: 150,
      outputTokens: 25,
    });
    expect(row.finishedAt).not.toBeNull();
    expect(findings).toHaveLength(0);
    expect(events.map((e) => e.event)).toEqual(['analysis:status', 'analysis:status']);
  });

  it('treats a response cut off by the token limit as invalid output', async () => {
    const job = await newJob();
    const truncated = new InvalidOutputError('truncated', '{"summary":"', null);
    const provider = scriptedProvider(truncated, truncated);
    const { outcome, row } = await run(provider, job);
    expect(outcome).toBe('failed');
    expect(row.errorCode).toBe('invalid_output');
    expect(provider.calls[1]!.repair?.problem).toMatch(/cut off/);
  });

  it('puts the job back in the queue on a retryable error, with Retry-After', async () => {
    const job = await newJob();
    const { outcome, row, events } = await run(
      scriptedProvider(new ProviderError('provider_rate_limited', true, 12_000)),
      job,
    );
    expect(outcome).toBeInstanceOf(RetryLaterError);
    expect(outcome).toMatchObject({ code: 'provider_rate_limited', retryAfterMs: 12_000 });
    expect(row).toMatchObject({
      status: 'queued',
      attempts: 1,
      errorCode: 'provider_rate_limited',
    });
    expect(events.map((e) => AnalysisStatusEventSchema.parse(e.payload).job.status)).toEqual([
      'running',
      'queued',
    ]);

    const second = await run(scriptedProvider(ok({ summary: 'ok', findings: [] })), job);
    expect(second.outcome).toBe('succeeded');
    expect(second.row).toMatchObject({ status: 'succeeded', attempts: 2, errorCode: null });
  });

  it.each([
    ['a timeout', new ProviderError('provider_timeout', true), 'provider_timeout'],
    ['a server error', new ProviderError('provider_error', true), 'provider_error'],
    ['a network error', new ProviderError('provider_unavailable', true), 'provider_unavailable'],
    ['an unexpected error', new Error('db hiccup'), 'internal_error'],
  ])('retries %s', async (_name, error, code) => {
    const job = await newJob();
    const { outcome, row } = await run(scriptedProvider(error), job);
    expect(outcome).toBeInstanceOf(RetryLaterError);
    expect(row).toMatchObject({ status: 'queued', errorCode: code });
  });

  it.each([
    ['a bad request', 'provider_bad_request'],
    ['an auth error', 'provider_auth'],
    ['an unknown model', 'provider_model_not_found'],
  ] as const)('fails at once on %s', async (_name, code) => {
    const job = await newJob();
    const { outcome, row } = await run(scriptedProvider(new ProviderError(code, false)), job);
    expect(outcome).toBe('failed');
    expect(row).toMatchObject({ status: 'failed', errorCode: code, attempts: 1 });
  });

  it('fails instead of waiting when Retry-After is longer than the limit', async () => {
    const job = await newJob();
    const { outcome, row } = await run(
      scriptedProvider(new ProviderError('provider_rate_limited', true, 6 * 60 * 60_000)),
      job,
    );
    expect(outcome).toBe('failed');
    expect(row.errorCode).toBe('provider_rate_limited');
  });

  it('fails on the last attempt', async () => {
    const job = await newJob();
    const error = () => scriptedProvider(new ProviderError('provider_error', true));
    expect((await run(error(), job, 2)).outcome).toBeInstanceOf(RetryLaterError);
    const last = await run(error(), job, 2);
    expect(last.outcome).toBe('failed');
    expect(last.row).toMatchObject({ status: 'failed', attempts: 2, errorCode: 'provider_error' });
  });

  it('lets only one of two workers start the same job', async () => {
    const job = await newJob();
    const { publisher } = recordingPublisher(app);
    const provider = scriptedProvider(
      ok({ summary: 'ok', findings: [] }),
      ok({ summary: 'ok', findings: [] }),
    );
    const deps = { db: app.db, provider, log: app.log, publisher };
    const outcomes = await Promise.all([
      processAnalysisJob(deps, job.id),
      processAnalysisJob(deps, job.id),
    ]);
    expect(outcomes.sort()).toEqual(['skipped', 'succeeded']);
    expect(provider.calls).toHaveLength(1);
  });

  it('skips a job that already finished', async () => {
    const job = await newJob();
    await run(scriptedProvider(ok({ summary: 'ok', findings: [] })), job);
    const again = await run(scriptedProvider(), job);
    expect(again.outcome).toBe('skipped');
    expect(again.events).toEqual([]);
  });

  it('discards the result when the sweeper failed the job meanwhile', async () => {
    const job = await newJob();
    const provider = scriptedProvider(() => {
      return ok({ summary: 'late', findings: [finding()] });
    });
    const slow: AiProvider = {
      model: provider.model,
      async analyze(input) {
        await app.db
          .update(aiAnalysisJobs)
          .set({ status: 'failed', errorCode: 'timed_out' })
          .where(eq(aiAnalysisJobs.id, job.id));
        return provider.analyze(input);
      },
    };
    const { outcome, row, findings } = await run(slow, job);
    expect(outcome).toBe('skipped');
    expect(row).toMatchObject({ status: 'failed', errorCode: 'timed_out' });
    expect(findings).toHaveLength(0);
  });

  describe('sweeper', () => {
    it('re-enqueues jobs stuck in queued and fails jobs running too long', async () => {
      const stuck = await newJob();
      const fresh = await newJob();
      const stale = await newJob();
      await app.db
        .update(aiAnalysisJobs)
        .set({ createdAt: sql`now() - interval '3 minutes'` })
        .where(eq(aiAnalysisJobs.id, stuck.id));
      await app.db
        .update(aiAnalysisJobs)
        .set({ status: 'running', startedAt: sql`now() - interval '11 minutes'` })
        .where(eq(aiAnalysisJobs.id, stale.id));

      const sweepQueue = new FakeQueue();
      const { publisher, events } = recordingPublisher(app);
      await sweep({ db: app.db, queue: sweepQueue, publisher, log: app.log });

      expect(sweepQueue.enqueued).toContain(stuck.id);
      expect(sweepQueue.enqueued).not.toContain(fresh.id);
      const [staleRow] = await app.db
        .select()
        .from(aiAnalysisJobs)
        .where(eq(aiAnalysisJobs.id, stale.id));
      expect(staleRow).toMatchObject({ status: 'failed', errorCode: 'timed_out' });
      expect(
        events.some((e) => AnalysisStatusEventSchema.parse(e.payload).job.id === stale.id),
      ).toBe(true);
    });

    it('keeps going when one re-enqueue fails', async () => {
      const stuck = await newJob();
      await app.db
        .update(aiAnalysisJobs)
        .set({ createdAt: sql`now() - interval '3 minutes'` })
        .where(eq(aiAnalysisJobs.id, stuck.id));
      const sweepQueue = new FakeQueue();
      sweepQueue.failNext = true;
      const { publisher } = recordingPublisher(app);
      await expect(
        sweep({ db: app.db, queue: sweepQueue, publisher, log: app.log }),
      ).resolves.toBeDefined();
    });
  });
});

describeWithDbAndRedis('analysis events over Socket.IO', () => {
  closeRealtimeResourcesAfterTests();

  it('delivers analysis:status and analysis:completed to the review room', async () => {
    const { app, url } = await startApp();
    const owner = await createUserWithSession(app.db);
    const { workspace, review } = await setupReview(app, owner);
    const socket = await connectAs(app, url, owner);
    expect(await join(socket, { workspaceId: workspace.id, reviewNumber: review.number })).toEqual({
      ok: true,
      reviewId: review.id,
    });

    const [job] = await app.db
      .insert(aiAnalysisJobs)
      .values({
        workspaceId: workspace.id,
        reviewId: review.id,
        requestedBy: owner.id,
        idempotencyKey: `socket-test-${review.id}`,
        promptVersion: 'test',
        model: 'scripted',
      })
      .returning();
    const publisher = createAnalysisPublisher({
      db: app.db,
      log: app.log,
      emit: (reviewId, event, payload) => app.realtime.emitToReview(reviewId, event, payload),
    });

    const completed = nextEvent(socket, 'analysis:completed');
    await processAnalysisJob(
      {
        db: app.db,
        provider: scriptedProvider(ok({ summary: 'ok', findings: [finding()] })),
        log: app.log,
        publisher,
      },
      job!.id,
    );
    expect(AnalysisCompletedEventSchema.parse(await completed)).toMatchObject({
      reviewId: review.id,
      jobId: job!.id,
      findings: 1,
    });
  });
});
