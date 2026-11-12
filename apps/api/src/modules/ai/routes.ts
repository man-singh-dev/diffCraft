import {
  FindingFeedbackRequestSchema,
  type AiFinding,
  type AiJob,
  type LatestAnalysisResponse,
} from '@diffcraft/shared';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { ValidationError } from '../../errors.js';
import { authUser } from '../auth/require-auth.js';
import { loadReview } from '../reviews/load-review.js';
import {
  requestWorkspace,
  requireWorkspaceRole,
  UUID_PATTERN,
} from '../workspaces/require-workspace-role.js';
import { AiDisabledError, FindingNotFoundError, ReviewNotOpenError } from './errors.js';
import {
  dismissFinding,
  getLatestAnalysis,
  requestAnalysis,
  setFindingFeedback,
} from './service.js';

function findingIdParam(request: FastifyRequest): string {
  const { findingId } = request.params as { findingId?: string };
  if (!findingId || !UUID_PATTERN.test(findingId)) throw new FindingNotFoundError();
  return findingId;
}

export const analysisRoutes: FastifyPluginAsync = async (app) => {
  app.post<{ Reply: AiJob }>(
    '/analyses',
    { preHandler: [requireWorkspaceRole('member'), app.limit('analysis-user')] },
    async (request, reply) => {
      if (!app.ai.enabled) throw new AiDisabledError();
      const review = await loadReview(app, request);
      if (review.status !== 'open') throw new ReviewNotOpenError();

      const actorId = authUser(request).id;
      const { job, created } = await requestAnalysis(app.db, {
        workspaceId: requestWorkspace(request).id,
        reviewId: review.id,
        requestedBy: actorId,
        model: app.ai.model,
        promptVersion: app.ai.promptVersion,
        dailyLimit: app.ai.dailyLimit,
      });
      if (!created) return reply.code(200).send(job);

      // After the commit: a worker must never pick up a job id whose row isn't visible yet.
      await app.ai.enqueue(job.id);
      await app.ai.publisher.status(job, actorId);
      return reply.code(202).send(job);
    },
  );

  app.get<{ Reply: LatestAnalysisResponse }>(
    '/analyses/latest',
    { preHandler: requireWorkspaceRole('viewer') },
    async (request) => {
      const review = await loadReview(app, request);
      const latest = await getLatestAnalysis(app.db, review.id, authUser(request).id);
      return { enabled: app.ai.enabled, ...latest };
    },
  );

  app.post<{ Reply: AiFinding }>(
    '/findings/:findingId/dismiss',
    { preHandler: requireWorkspaceRole('member') },
    async (request) => {
      const review = await loadReview(app, request);
      const findingId = findingIdParam(request);
      const finding = await dismissFinding(app.db, review.id, findingId, authUser(request).id);
      if (!finding) throw new FindingNotFoundError();
      return finding;
    },
  );

  app.put<{ Reply: AiFinding }>(
    '/findings/:findingId/feedback',
    { preHandler: requireWorkspaceRole('member') },
    async (request) => {
      const review = await loadReview(app, request);
      const findingId = findingIdParam(request);
      const parsed = FindingFeedbackRequestSchema.safeParse(request.body);
      if (!parsed.success) throw new ValidationError(parsed.error.issues);
      const finding = await setFindingFeedback(
        app.db,
        review.id,
        findingId,
        authUser(request).id,
        parsed.data.helpful,
      );
      if (!finding) throw new FindingNotFoundError();
      return finding;
    },
  );

  app.delete<{ Reply: AiFinding }>(
    '/findings/:findingId/feedback',
    { preHandler: requireWorkspaceRole('member') },
    async (request) => {
      const review = await loadReview(app, request);
      const findingId = findingIdParam(request);
      const finding = await setFindingFeedback(
        app.db,
        review.id,
        findingId,
        authUser(request).id,
        null,
      );
      if (!finding) throw new FindingNotFoundError();
      return finding;
    },
  );
};
