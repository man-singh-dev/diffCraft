import {
  AssignReviewersRequestSchema,
  canAssignReviewers,
  canDecide,
  canMerge,
  hasAtLeastRole,
  SubmitDecisionRequestSchema,
  UpdateApprovalRulesRequestSchema,
  type ApprovalRules,
  type Review,
  type ReviewDecision,
  type ReviewEvent,
  type Reviewer,
  type ReviewState,
} from '@diffcraft/shared';
import type { FastifyPluginAsync } from 'fastify';
import type { z } from 'zod';
import { ForbiddenError, ValidationError } from '../../errors.js';
import { authUser } from '../auth/require-auth.js';
import { publishReviewChanged } from '../realtime/publish.js';
import { ReviewNotFoundError } from '../reviews/errors.js';
import { loadReview } from '../reviews/load-review.js';
import {
  requestWorkspace,
  requireWorkspaceRole,
  UUID_PATTERN,
  WorkspaceNotFoundError,
} from '../workspaces/require-workspace-role.js';
import { NotAReviewerError, ReviewerNotFoundError, ReviewNotOpenError } from './errors.js';
import {
  assignReviewers,
  getReviewState,
  getRules,
  isReviewer,
  listDecisions,
  listEvents,
  listReviewers,
  mergeReview,
  removeReviewer,
  submitDecision,
  updateRules,
} from './service.js';

function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ValidationError(parsed.error.issues);
  return parsed.data;
}

// Registered inside the single-review routes; checks run review → target → permission → body.
export const approvalRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Reply: ReviewState }>(
    '/state',
    { preHandler: requireWorkspaceRole('viewer') },
    async (request) => {
      const review = await loadReview(app, request);
      const state = await getReviewState(app.db, requestWorkspace(request).id, review.id);
      if (!state) throw new ReviewNotFoundError();
      return state;
    },
  );

  app.get<{ Reply: Reviewer[] }>(
    '/reviewers',
    { preHandler: requireWorkspaceRole('viewer') },
    async (request) => {
      const review = await loadReview(app, request);
      return listReviewers(app.db, requestWorkspace(request).id, review.id);
    },
  );

  app.post<{ Reply: Reviewer[] }>(
    '/reviewers',
    { preHandler: requireWorkspaceRole('member') },
    async (request) => {
      const review = await loadReview(app, request);
      const { id: workspaceId, role } = requestWorkspace(request);
      const actorId = authUser(request).id;
      if (!canAssignReviewers(role, actorId, review.author?.id ?? null)) {
        throw new ForbiddenError();
      }
      const { userIds } = parseBody(AssignReviewersRequestSchema, request.body);
      const reviewers = await assignReviewers(app.db, {
        workspaceId,
        reviewId: review.id,
        actorId,
        userIds,
      });
      await publishReviewChanged(app, { reviewId: review.id, actorId, reason: 'reviewers' });
      return reviewers;
    },
  );

  app.delete(
    '/reviewers/:userId',
    { preHandler: requireWorkspaceRole('member') },
    async (request, reply) => {
      const review = await loadReview(app, request);
      const { id: workspaceId, role } = requestWorkspace(request);
      const { userId } = request.params as { userId?: string };
      if (!userId || !UUID_PATTERN.test(userId)) throw new ReviewerNotFoundError();
      if (!(await isReviewer(app.db, workspaceId, review.id, userId))) {
        throw new ReviewerNotFoundError();
      }

      const actorId = authUser(request).id;
      if (userId !== actorId && !canAssignReviewers(role, actorId, review.author?.id ?? null)) {
        throw new ForbiddenError();
      }
      const removed = await removeReviewer(app.db, {
        workspaceId,
        reviewId: review.id,
        actorId,
        userId,
      });
      if (!removed) throw new ReviewerNotFoundError();
      await publishReviewChanged(app, { reviewId: review.id, actorId, reason: 'reviewers' });
      return reply.code(204).send();
    },
  );

  app.post<{ Reply: ReviewDecision }>(
    '/decisions',
    { preHandler: requireWorkspaceRole('member') },
    async (request, reply) => {
      const review = await loadReview(app, request);
      const { id: workspaceId, role } = requestWorkspace(request);
      const userId = authUser(request).id;
      const assigned = await isReviewer(app.db, workspaceId, review.id, userId);
      if (!canDecide(role, userId, review, assigned)) {
        if (!hasAtLeastRole(role, 'member') || review.author?.id === userId) {
          throw new ForbiddenError();
        }
        if (!assigned) throw new NotAReviewerError();
        throw new ReviewNotOpenError();
      }
      const { decision, body } = parseBody(SubmitDecisionRequestSchema, request.body);

      const created = await submitDecision(app.db, {
        workspaceId,
        reviewId: review.id,
        reviewerId: userId,
        decision,
        body,
      });
      await publishReviewChanged(app, { reviewId: review.id, actorId: userId, reason: 'decision' });
      return reply.code(201).send(created);
    },
  );

  app.get<{ Reply: ReviewDecision[] }>(
    '/decisions',
    { preHandler: requireWorkspaceRole('viewer') },
    async (request) => {
      const review = await loadReview(app, request);
      return listDecisions(app.db, requestWorkspace(request).id, review.id);
    },
  );

  app.post<{ Reply: Review }>(
    '/merge',
    { preHandler: requireWorkspaceRole('member') },
    async (request) => {
      const review = await loadReview(app, request);
      const { id: workspaceId, role } = requestWorkspace(request);
      const actorId = authUser(request).id;
      if (!canMerge(role, actorId, review.author?.id ?? null)) throw new ForbiddenError();
      const merged = await mergeReview(app.db, { workspaceId, reviewId: review.id, actorId });
      await publishReviewChanged(app, { reviewId: review.id, actorId, reason: 'merged' });
      return merged;
    },
  );

  app.get<{ Reply: ReviewEvent[] }>(
    '/events',
    { preHandler: requireWorkspaceRole('viewer') },
    async (request) => {
      const review = await loadReview(app, request);
      return listEvents(app.db, requestWorkspace(request).id, review.id);
    },
  );
};

export const ruleRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Reply: ApprovalRules }>(
    '/',
    { preHandler: requireWorkspaceRole('viewer') },
    async (request) => {
      const rules = await getRules(app.db, requestWorkspace(request).id);
      if (!rules) throw new WorkspaceNotFoundError();
      return rules;
    },
  );

  app.patch<{ Reply: ApprovalRules }>(
    '/',
    { preHandler: requireWorkspaceRole('admin') },
    async (request) => {
      const changes = parseBody(UpdateApprovalRulesRequestSchema, request.body);
      const rules = await updateRules(app.db, requestWorkspace(request).id, changes);
      if (!rules) throw new WorkspaceNotFoundError();
      return rules;
    },
  );
};
