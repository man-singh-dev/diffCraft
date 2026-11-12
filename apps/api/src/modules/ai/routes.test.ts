import { randomUUID } from 'node:crypto';
import {
  AiFindingDtoSchema,
  AiJobSchema,
  ErrorResponseSchema,
  LatestAnalysisResponseSchema,
  type WorkspaceRole,
} from '@diffcraft/shared';
import { eq, sql } from 'drizzle-orm';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';
import { aiAnalysisJobs, aiFindings, findingFeedback } from '../../db/schema/index.js';
import { describeWithDb, testDatabaseUrl } from '../../test/db.js';
import { addMember, createUserWithSession, type TestUser } from '../../test/fixtures.js';
import { createFakeProvider } from './providers/fake.js';
import {
  analysesUrl,
  FakeQueue,
  recordingPublisher,
  setupReview,
  startAnalysis,
} from './test-helpers.js';
import { processAnalysisJob } from './worker.js';

const DAILY_LIMIT = 3;

describeWithDb('analysis routes', () => {
  let app: FastifyInstance;
  let disabledApp: FastifyInstance;
  let owner: TestUser;
  const queue = new FakeQueue();

  beforeAll(async () => {
    const config = loadConfig({
      LOG_LEVEL: 'silent',
      RATE_LIMIT_ENABLED: 'false',
      NODE_ENV: 'test',
      DATABASE_URL: testDatabaseUrl,
      AI_MAX_JOBS_PER_WORKSPACE_PER_DAY: String(DAILY_LIMIT),
    });
    app = await buildApp(config, { ai: { queue, worker: false, provider: createFakeProvider() } });
    disabledApp = await buildApp(
      { ...config, AI_PROVIDER: 'disabled' },
      { ai: { queue: new FakeQueue(), worker: false } },
    );
    owner = await createUserWithSession(app.db);
  });

  afterAll(async () => {
    await Promise.all([app.close(), disabledApp.close()]);
  });

  const errorOf = (res: LightMyRequestResponse) => ErrorResponseSchema.parse(res.json()).error;

  const call = (
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    url: string,
    user?: TestUser,
    on = app,
    payload?: unknown,
  ) =>
    on.inject({
      method,
      url,
      ...(user && { cookies: user.cookies }),
      ...(payload !== undefined && { payload: payload as object }),
    });

  async function memberWithRole(workspaceId: string, role: WorkspaceRole): Promise<TestUser> {
    const user = await createUserWithSession(app.db);
    await addMember(app.db, workspaceId, user.id, role);
    return user;
  }

  describe('POST /analyses', () => {
    it('queues a job, enqueues it by id and returns 202', async () => {
      const { workspace, review } = await setupReview(app, owner);
      const job = await startAnalysis(app, owner, workspace.id, review);
      expect(job).toMatchObject({
        reviewId: review.id,
        status: 'queued',
        requestedBy: owner.id,
        model: 'fake',
        attempts: 0,
      });
      expect(queue.enqueued).toContain(job.id);
    });

    it('returns the active job for a second identical request (200), creating one job', async () => {
      const { workspace, review } = await setupReview(app, owner);
      const url = analysesUrl(workspace.id, review, '/analyses');
      const [first, second] = await Promise.all([
        call('POST', url, owner),
        call('POST', url, owner),
      ]);
      expect([first.statusCode, second.statusCode].sort()).toEqual([200, 202]);
      expect(AiJobSchema.parse(first.json()).id).toBe(AiJobSchema.parse(second.json()).id);
      const rows = await app.db
        .select()
        .from(aiAnalysisJobs)
        .where(eq(aiAnalysisJobs.reviewId, review.id));
      expect(rows).toHaveLength(1);
    });

    it('creates a new job once the previous one finished', async () => {
      const { workspace, review } = await setupReview(app, owner);
      const first = await startAnalysis(app, owner, workspace.id, review);
      await app.db
        .update(aiAnalysisJobs)
        .set({ status: 'succeeded' })
        .where(eq(aiAnalysisJobs.id, first.id));
      const second = await startAnalysis(app, owner, workspace.id, review);
      expect(second.id).not.toBe(first.id);
    });

    it('returns 429 with Retry-After once the workspace used its daily analyses', async () => {
      const { workspace, review } = await setupReview(app, owner);
      for (let i = 0; i < DAILY_LIMIT; i++) {
        const job = await startAnalysis(app, owner, workspace.id, review);
        await app.db
          .update(aiAnalysisJobs)
          .set({ status: 'failed' })
          .where(eq(aiAnalysisJobs.id, job.id));
      }
      // The oldest job is 23 hours old: a slot frees up in about an hour.
      const [oldest] = await app.db
        .select()
        .from(aiAnalysisJobs)
        .where(eq(aiAnalysisJobs.workspaceId, workspace.id))
        .orderBy(aiAnalysisJobs.createdAt)
        .limit(1);
      await app.db
        .update(aiAnalysisJobs)
        .set({ createdAt: sql`now() - interval '23 hours'` })
        .where(eq(aiAnalysisJobs.id, oldest!.id));

      const res = await call('POST', analysesUrl(workspace.id, review, '/analyses'), owner);
      expect(res.statusCode).toBe(429);
      expect(errorOf(res).code).toBe('analysis_limit_reached');
      const retryAfter = Number(res.headers['retry-after']);
      expect(retryAfter).toBeGreaterThan(3_500);
      expect(retryAfter).toBeLessThanOrEqual(3_600);

      // Jobs older than 24 hours no longer count.
      await app.db
        .update(aiAnalysisJobs)
        .set({ createdAt: sql`now() - interval '25 hours'` })
        .where(eq(aiAnalysisJobs.id, oldest!.id));
      await startAnalysis(app, owner, workspace.id, review);
    });

    it('still returns the active job when the limit is reached', async () => {
      const { workspace, review } = await setupReview(app, owner);
      const active = await startAnalysis(app, owner, workspace.id, review);
      await app.db.insert(aiAnalysisJobs).values(
        Array.from({ length: DAILY_LIMIT }, () => ({
          workspaceId: workspace.id,
          reviewId: review.id,
          idempotencyKey: randomUUID(),
          promptVersion: 'old',
          model: 'old',
          status: 'failed' as const,
        })),
      );
      const res = await call('POST', analysesUrl(workspace.id, review, '/analyses'), owner);
      expect(res.statusCode).toBe(200);
      expect(AiJobSchema.parse(res.json()).id).toBe(active.id);
    });

    it('returns 202 even if enqueueing fails: the sweeper picks the job up', async () => {
      const { workspace, review } = await setupReview(app, owner);
      queue.failNext = true;
      const job = await startAnalysis(app, owner, workspace.id, review);
      expect(queue.enqueued).not.toContain(job.id);
    });

    it('returns 503 when AI is disabled', async () => {
      const { workspace, review } = await setupReview(app, owner);
      const res = await call(
        'POST',
        analysesUrl(workspace.id, review, '/analyses'),
        owner,
        disabledApp,
      );
      expect(res.statusCode).toBe(503);
      expect(errorOf(res).code).toBe('ai_disabled');
    });

    it.each(['closed', 'merged'] as const)('returns 409 for a %s review', async (status) => {
      const { workspace, review } = await setupReview(app, owner);
      const close = await app.inject({
        method: 'PATCH',
        url: analysesUrl(workspace.id, review),
        cookies: owner.cookies,
        payload: { status: 'closed' },
      });
      expect(close.statusCode).toBe(200);
      if (status === 'merged') {
        await app.db.execute(
          sql`update reviews set status = 'merged', merged_at = now() where id = ${review.id}`,
        );
      }
      const res = await call('POST', analysesUrl(workspace.id, review, '/analyses'), owner);
      expect(res.statusCode).toBe(409);
      expect(errorOf(res).code).toBe('review_not_open');
    });

    it.each([
      ['logged out', 401],
      ['non-member', 404],
      ['viewer', 403],
      ['member', 202],
    ] as const)('answers a %s with %i', async (caller, expected) => {
      const { workspace, review } = await setupReview(app, owner);
      const user =
        caller === 'logged out'
          ? undefined
          : caller === 'non-member'
            ? await createUserWithSession(app.db)
            : await memberWithRole(workspace.id, caller);
      const res = await call('POST', analysesUrl(workspace.id, review, '/analyses'), user);
      expect(res.statusCode).toBe(expected);
    });

    it("returns 404 for another workspace's review number (IDOR)", async () => {
      const { review } = await setupReview(app, owner);
      const intruder = await createUserWithSession(app.db);
      const { workspace: own } = await setupReview(app, intruder);
      const res = await call(
        'POST',
        analysesUrl(own.id, { number: review.number + 1000 }, '/analyses'),
        intruder,
      );
      expect(res.statusCode).toBe(404);
      expect(errorOf(res).code).toBe('review_not_found');
    });
  });

  async function analyzedReview() {
    const { workspace, review } = await setupReview(app, owner);
    const job = await startAnalysis(app, owner, workspace.id, review);
    const { publisher } = recordingPublisher(app);
    await processAnalysisJob(
      { db: app.db, provider: createFakeProvider(), log: app.log, publisher },
      job.id,
    );
    return { workspace, review, job };
  }

  describe('GET /analyses/latest and dismiss', () => {
    it('returns null and no findings before any analysis', async () => {
      const { workspace, review } = await setupReview(app, owner);
      const viewer = await memberWithRole(workspace.id, 'viewer');
      const res = await call('GET', analysesUrl(workspace.id, review, '/analyses/latest'), viewer);
      expect(res.statusCode).toBe(200);
      expect(LatestAnalysisResponseSchema.parse(res.json())).toEqual({
        enabled: true,
        job: null,
        findings: [],
      });
    });

    it('returns the newest job and the findings of the newest succeeded one', async () => {
      const { workspace, review, job } = await analyzedReview();
      const latestUrl = analysesUrl(workspace.id, review, '/analyses/latest');
      const done = LatestAnalysisResponseSchema.parse((await call('GET', latestUrl, owner)).json());
      expect(done.job).toMatchObject({ id: job.id, status: 'succeeded' });
      expect(done.findings).toEqual([
        expect.objectContaining({
          jobId: job.id,
          filePath: 'src/app.ts',
          side: 'new',
          lineStart: 2,
        }),
      ]);

      await app.db
        .update(aiAnalysisJobs)
        .set({ createdAt: sql`now() - interval '1 minute'` })
        .where(eq(aiAnalysisJobs.id, job.id));
      const next = await startAnalysis(app, owner, workspace.id, review);
      const pending = LatestAnalysisResponseSchema.parse(
        (await call('GET', latestUrl, owner)).json(),
      );
      expect(pending.job).toMatchObject({ id: next.id, status: 'queued' });
      expect(pending.findings).toHaveLength(1);
    });

    it('dismisses a finding idempotently and hides it from latest', async () => {
      const { workspace, review } = await analyzedReview();
      const latestUrl = analysesUrl(workspace.id, review, '/analyses/latest');
      const [target] = LatestAnalysisResponseSchema.parse(
        (await call('GET', latestUrl, owner)).json(),
      ).findings;
      const member = await memberWithRole(workspace.id, 'member');
      const dismissUrl = analysesUrl(workspace.id, review, `/findings/${target!.id}/dismiss`);

      const first = await call('POST', dismissUrl, member);
      expect(first.statusCode).toBe(200);
      const dismissed = AiFindingDtoSchema.parse(first.json());
      expect(dismissed.dismissedAt).not.toBeNull();

      const second = await call('POST', dismissUrl, member);
      expect(second.statusCode).toBe(200);
      expect(AiFindingDtoSchema.parse(second.json()).dismissedAt).toBe(dismissed.dismissedAt);

      const after = LatestAnalysisResponseSchema.parse(
        (await call('GET', latestUrl, owner)).json(),
      );
      expect(after.findings).toEqual([]);
    });

    it('scopes dismiss to the review and its workspace', async () => {
      const { workspace, review } = await analyzedReview();
      const [target] = LatestAnalysisResponseSchema.parse(
        (await call('GET', analysesUrl(workspace.id, review, '/analyses/latest'), owner)).json(),
      ).findings;
      const path = `/findings/${target!.id}/dismiss`;

      const other = await setupReview(app, owner);
      const viaOtherReview = await call(
        'POST',
        analysesUrl(other.workspace.id, other.review, path),
        owner,
      );
      expect(viaOtherReview.statusCode).toBe(404);
      expect(errorOf(viaOtherReview).code).toBe('finding_not_found');

      const outsider = await createUserWithSession(app.db);
      expect(
        (await call('POST', analysesUrl(workspace.id, review, path), outsider)).statusCode,
      ).toBe(404);
      const viewer = await memberWithRole(workspace.id, 'viewer');
      expect((await call('POST', analysesUrl(workspace.id, review, path), viewer)).statusCode).toBe(
        403,
      );
      expect(
        (await call('POST', analysesUrl(workspace.id, review, '/findings/nope/dismiss'), owner))
          .statusCode,
      ).toBe(404);
      expect(
        (
          await call(
            'POST',
            analysesUrl(workspace.id, review, `/findings/${randomUUID()}/dismiss`),
            owner,
          )
        ).statusCode,
      ).toBe(404);
    });

    it('says whether AI is enabled', async () => {
      const { workspace, review } = await setupReview(app, owner);
      const res = await call(
        'GET',
        analysesUrl(workspace.id, review, '/analyses/latest'),
        owner,
        disabledApp,
      );
      expect(LatestAnalysisResponseSchema.parse(res.json()).enabled).toBe(false);
    });

    it('hides latest from non-members', async () => {
      const { workspace, review } = await analyzedReview();
      const outsider = await createUserWithSession(app.db);
      const res = await call(
        'GET',
        analysesUrl(workspace.id, review, '/analyses/latest'),
        outsider,
      );
      expect(res.statusCode).toBe(404);
    });
  });

  describe('finding feedback', () => {
    async function feedbackSetup() {
      const { workspace, review } = await analyzedReview();
      const latestUrl = analysesUrl(workspace.id, review, '/analyses/latest');
      const [target] = LatestAnalysisResponseSchema.parse(
        (await call('GET', latestUrl, owner)).json(),
      ).findings;
      const url = analysesUrl(workspace.id, review, `/findings/${target!.id}/feedback`);
      const latestFor = async (user: TestUser) =>
        LatestAnalysisResponseSchema.parse((await call('GET', latestUrl, user)).json())
          .findings[0]!;
      return { workspace, review, target: target!, url, latestFor };
    }

    const rowsFor = (findingId: string) =>
      app.db.select().from(findingFeedback).where(eq(findingFeedback.findingId, findingId));

    it('starts with no feedback', async () => {
      const { target } = await feedbackSetup();
      expect(target.myFeedback).toBeNull();
      expect(target.feedback).toEqual({ helpful: 0, notHelpful: 0 });
    });

    it('upserts: answering twice keeps one row with the last answer', async () => {
      const { target, url, latestFor } = await feedbackSetup();
      const first = await call('PUT', url, owner, app, { helpful: true });
      expect(first.statusCode).toBe(200);
      expect(AiFindingDtoSchema.parse(first.json())).toMatchObject({
        myFeedback: true,
        feedback: { helpful: 1, notHelpful: 0 },
      });
      const second = await call('PUT', url, owner, app, { helpful: false });
      expect(AiFindingDtoSchema.parse(second.json())).toMatchObject({
        myFeedback: false,
        feedback: { helpful: 0, notHelpful: 1 },
      });
      expect(await rowsFor(target.id)).toHaveLength(1);
      expect(await latestFor(owner)).toMatchObject({ myFeedback: false });
    });

    it("keeps each user's feedback separate and counts them together", async () => {
      const { workspace, url, latestFor } = await feedbackSetup();
      const member = await memberWithRole(workspace.id, 'member');
      const viewer = await memberWithRole(workspace.id, 'viewer');
      await call('PUT', url, owner, app, { helpful: true });
      await call('PUT', url, member, app, { helpful: false });

      expect(await latestFor(owner)).toMatchObject({
        myFeedback: true,
        feedback: { helpful: 1, notHelpful: 1 },
      });
      expect(await latestFor(member)).toMatchObject({ myFeedback: false });
      expect(await latestFor(viewer)).toMatchObject({
        myFeedback: null,
        feedback: { helpful: 1, notHelpful: 1 },
      });
    });

    it("removes only the caller's feedback on DELETE", async () => {
      const { workspace, target, url } = await feedbackSetup();
      const member = await memberWithRole(workspace.id, 'member');
      await call('PUT', url, owner, app, { helpful: true });
      await call('PUT', url, member, app, { helpful: true });
      const res = await call('DELETE', url, owner);
      expect(res.statusCode).toBe(200);
      expect(AiFindingDtoSchema.parse(res.json())).toMatchObject({
        myFeedback: null,
        feedback: { helpful: 1, notHelpful: 0 },
      });
      expect((await call('DELETE', url, owner)).statusCode).toBe(200);
      expect(await rowsFor(target.id)).toHaveLength(1);
    });

    it('is deleted with its finding', async () => {
      const { target, url } = await feedbackSetup();
      await call('PUT', url, owner, app, { helpful: true });
      await app.db.delete(aiFindings).where(eq(aiFindings.id, target.id));
      expect(await rowsFor(target.id)).toHaveLength(0);
    });

    it('validates the body', async () => {
      const { url } = await feedbackSetup();
      for (const payload of [{}, { helpful: 'yes' }, { helpful: null }]) {
        const res = await call('PUT', url, owner, app, payload);
        expect(res.statusCode).toBe(422);
      }
    });

    it('is scoped to the review, its workspace and members', async () => {
      const { workspace, review, target } = await feedbackSetup();
      const path = `/findings/${target.id}/feedback`;
      const other = await setupReview(app, owner);
      const viaOther = await call(
        'PUT',
        analysesUrl(other.workspace.id, other.review, path),
        owner,
        app,
        { helpful: true },
      );
      expect(viaOther.statusCode).toBe(404);
      expect(errorOf(viaOther).code).toBe('finding_not_found');

      const url = analysesUrl(workspace.id, review, path);
      const outsider = await createUserWithSession(app.db);
      expect((await call('PUT', url, outsider, app, { helpful: true })).statusCode).toBe(404);
      expect((await call('DELETE', url, outsider)).statusCode).toBe(404);
      const viewer = await memberWithRole(workspace.id, 'viewer');
      expect((await call('PUT', url, viewer, app, { helpful: true })).statusCode).toBe(403);
      expect((await call('PUT', url, undefined, app, { helpful: true })).statusCode).toBe(401);
      const unknown = analysesUrl(workspace.id, review, `/findings/${randomUUID()}/feedback`);
      expect((await call('PUT', unknown, owner, app, { helpful: true })).statusCode).toBe(404);
      expect(await rowsFor(target.id)).toHaveLength(0);
    });
  });
});
