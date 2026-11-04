import {
  canDeleteComment,
  canEditComment,
  canResolveThread,
  CreateThreadRequestSchema,
  EditCommentRequestSchema,
  ReplyRequestSchema,
  SetThreadStatusRequestSchema,
  type Comment,
  type Review,
  type Thread,
} from '@diffcraft/shared';
import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from 'fastify';
import type { z } from 'zod';
import { ForbiddenError, ValidationError } from '../../errors.js';
import { authUser } from '../auth/require-auth.js';
import { loadReview } from '../reviews/load-review.js';
import {
  requestWorkspace,
  requireWorkspaceRole,
  UUID_PATTERN,
} from '../workspaces/require-workspace-role.js';
import { CommentNotFoundError, ThreadNotFoundError } from './errors.js';
import {
  addReply,
  createThread,
  deleteComment,
  editComment,
  getComment,
  getThread,
  listThreads,
  setThreadStatus,
} from './service.js';

function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ValidationError(parsed.error.issues);
  return parsed.data;
}

// The checks run in a fixed order: review (404) → thread in this review (404) → comment in that
// thread (404) → permission (403) → body (422). So a caller learns nothing about a thread or
// comment they couldn't reach, and a forbidden request fails the same way whatever its body.

/** The review and the thread named in the URL; 404 unless the thread is in this review. */
async function loadThread(
  app: FastifyInstance,
  request: FastifyRequest,
): Promise<{ review: Review; thread: Thread }> {
  const review = await loadReview(app, request);
  const { threadId } = request.params as { threadId?: string };
  if (!threadId || !UUID_PATTERN.test(threadId)) throw new ThreadNotFoundError();

  const thread = await getThread(app.db, requestWorkspace(request).id, review.id, threadId);
  if (!thread) throw new ThreadNotFoundError();
  return { review, thread };
}

/**
 * The comment named in the URL; 404 unless it is in *that* thread (not just the same review) and
 * not deleted. A deleted comment can't be edited or deleted again, so both get this 404.
 */
async function loadComment(
  app: FastifyInstance,
  request: FastifyRequest,
): Promise<{ review: Review; thread: Thread; comment: Comment }> {
  const { review, thread } = await loadThread(app, request);
  const { commentId } = request.params as { commentId?: string };
  if (!commentId || !UUID_PATTERN.test(commentId)) throw new CommentNotFoundError();

  const comment = await getComment(app.db, requestWorkspace(request).id, review.id, commentId);
  if (!comment || comment.threadId !== thread.id || comment.deleted) {
    throw new CommentNotFoundError();
  }
  return { review, thread, comment };
}

/**
 * /:workspaceId/reviews/:reviewNumber/threads. Registered inside the review routes, so requireAuth
 * and the :reviewNumber check have run. Creating, replying and resolving need a member at least;
 * editing and deleting a comment are decided by canEditComment / canDeleteComment alone.
 * Comments are allowed on closed reviews.
 */
export const commentRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Reply: Thread[] }>(
    '/',
    { preHandler: requireWorkspaceRole('viewer') },
    async (request) => {
      const review = await loadReview(app, request);
      return listThreads(app.db, requestWorkspace(request).id, review.id);
    },
  );

  app.post<{ Reply: Thread }>(
    '/',
    { preHandler: requireWorkspaceRole('member') },
    async (request, reply) => {
      const review = await loadReview(app, request);
      const input = parseBody(CreateThreadRequestSchema, request.body);
      const thread = await createThread(app.db, {
        workspaceId: requestWorkspace(request).id,
        reviewId: review.id,
        authorId: authUser(request).id,
        input,
      });
      return reply.code(201).send(thread);
    },
  );

  app.patch<{ Reply: Thread }>(
    '/:threadId',
    { preHandler: requireWorkspaceRole('member') },
    async (request) => {
      const { review, thread } = await loadThread(app, request);
      const { id: workspaceId, role } = requestWorkspace(request);
      const userId = authUser(request).id;
      if (!canResolveThread(role, userId, thread, review.author?.id ?? null)) {
        throw new ForbiddenError();
      }
      const { status } = parseBody(SetThreadStatusRequestSchema, request.body);

      const updated = await setThreadStatus(app.db, {
        workspaceId,
        reviewId: review.id,
        threadId: thread.id,
        userId,
        status,
      });
      if (!updated) throw new ThreadNotFoundError();
      return updated;
    },
  );

  app.post<{ Reply: Comment }>(
    '/:threadId/comments',
    { preHandler: requireWorkspaceRole('member') },
    async (request, reply) => {
      const { review, thread } = await loadThread(app, request);
      const { body } = parseBody(ReplyRequestSchema, request.body);
      const comment = await addReply(app.db, {
        workspaceId: requestWorkspace(request).id,
        reviewId: review.id,
        threadId: thread.id,
        authorId: authUser(request).id,
        body,
      });
      if (!comment) throw new ThreadNotFoundError();
      return reply.code(201).send(comment);
    },
  );

  app.patch<{ Reply: Comment }>(
    '/:threadId/comments/:commentId',
    { preHandler: requireWorkspaceRole('viewer') },
    async (request) => {
      const { review, comment } = await loadComment(app, request);
      if (!canEditComment(authUser(request).id, comment)) throw new ForbiddenError();
      const { body } = parseBody(EditCommentRequestSchema, request.body);

      const edited = await editComment(
        app.db,
        requestWorkspace(request).id,
        review.id,
        comment.id,
        body,
      );
      // Deleted between the lookup and the update.
      if (!edited) throw new CommentNotFoundError();
      return edited;
    },
  );

  app.delete<{ Reply: Comment }>(
    '/:threadId/comments/:commentId',
    { preHandler: requireWorkspaceRole('viewer') },
    async (request) => {
      const { review, comment } = await loadComment(app, request);
      const { id: workspaceId, role } = requestWorkspace(request);
      if (!canDeleteComment(role, authUser(request).id, comment)) throw new ForbiddenError();

      const deleted = await deleteComment(app.db, workspaceId, review.id, comment.id);
      if (!deleted) throw new CommentNotFoundError();
      return deleted;
    },
  );
};
