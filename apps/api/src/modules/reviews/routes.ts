import {
  canEditReview,
  CreateReviewRequestSchema,
  DiffParseError,
  ListReviewsQuerySchema,
  UpdateReviewRequestSchema,
  type Review,
  type ReviewFile,
  type ReviewFileDiff,
  type ReviewListResponse,
} from '@diffcraft/shared';
import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from 'fastify';
import { ForbiddenError, ValidationError } from '../../errors.js';
import { authUser } from '../auth/require-auth.js';
import {
  requestWorkspace,
  requireWorkspaceRole,
  UUID_PATTERN,
} from '../workspaces/require-workspace-role.js';
import { commentRoutes } from '../comments/routes.js';
import { decodeCursor } from './cursor.js';
import {
  InvalidCursorError,
  InvalidPatchError,
  ReviewFileNotFoundError,
  ReviewNotFoundError,
} from './errors.js';
import { loadReview, reviewNumberParam } from './load-review.js';
import {
  createReview,
  deleteReview,
  getReviewFileDiff,
  listReviewFiles,
  listReviews,
  updateReview,
} from './service.js';

// JSON escaping can double a patch's size, so a 1 MiB patch needs ~2 MiB of JSON; parsePatch still enforces the real 1 MiB limit.
export const CREATE_REVIEW_BODY_LIMIT = 3 * 1024 * 1024;

async function loadEditableReview(app: FastifyInstance, request: FastifyRequest): Promise<Review> {
  const review = await loadReview(app, request);
  const { role } = requestWorkspace(request);
  if (!canEditReview(role, authUser(request).id, review)) throw new ForbiddenError();
  return review;
}

const singleReviewRoutes: FastifyPluginAsync = async (app) => {
  // Before requireWorkspaceRole, so a malformed number never reaches the database; the same 404 for every workspace id reveals nothing.
  app.addHook('preHandler', async (request) => {
    reviewNumberParam(request);
  });

  app.get<{ Reply: Review }>('/', { preHandler: requireWorkspaceRole('viewer') }, (request) =>
    loadReview(app, request),
  );

  app.patch<{ Reply: Review }>(
    '/',
    { preHandler: requireWorkspaceRole('member') },
    async (request) => {
      const review = await loadEditableReview(app, request);
      const parsed = UpdateReviewRequestSchema.safeParse(request.body);
      if (!parsed.success) throw new ValidationError(parsed.error.issues);

      const updated = await updateReview(
        app.db,
        requestWorkspace(request).id,
        review.id,
        parsed.data,
      );
      if (!updated) throw new ReviewNotFoundError();
      return updated;
    },
  );

  app.delete('/', { preHandler: requireWorkspaceRole('member') }, async (request, reply) => {
    const review = await loadEditableReview(app, request);
    if (!(await deleteReview(app.db, requestWorkspace(request).id, review.id))) {
      throw new ReviewNotFoundError();
    }
    return reply.code(204).send();
  });

  app.get<{ Reply: ReviewFile[] }>(
    '/files',
    { preHandler: requireWorkspaceRole('viewer') },
    async (request) => {
      const review = await loadReview(app, request);
      return listReviewFiles(app.db, requestWorkspace(request).id, review.id);
    },
  );

  app.get<{ Reply: ReviewFileDiff }>(
    '/files/:fileId/diff',
    { preHandler: requireWorkspaceRole('viewer') },
    async (request) => {
      const review = await loadReview(app, request);
      const { fileId } = request.params as { fileId?: string };
      if (!fileId || !UUID_PATTERN.test(fileId)) throw new ReviewFileNotFoundError();

      const diff = await getReviewFileDiff(app.db, requestWorkspace(request).id, review.id, fileId);
      if (!diff) throw new ReviewFileNotFoundError();
      return diff;
    },
  );

  await app.register(commentRoutes, { prefix: '/threads' });
};

export const reviewRoutes: FastifyPluginAsync = async (app) => {
  app.post<{ Reply: Review }>(
    '/',
    { bodyLimit: CREATE_REVIEW_BODY_LIMIT, preHandler: requireWorkspaceRole('member') },
    async (request, reply) => {
      const parsed = CreateReviewRequestSchema.safeParse(request.body);
      if (!parsed.success) throw new ValidationError(parsed.error.issues);

      try {
        const review = await createReview(app.db, {
          workspaceId: requestWorkspace(request).id,
          authorId: authUser(request).id,
          input: parsed.data,
        });
        return await reply.code(201).send(review);
      } catch (error) {
        if (error instanceof DiffParseError) throw new InvalidPatchError(error);
        throw error;
      }
    },
  );

  app.get<{ Reply: ReviewListResponse }>(
    '/',
    { preHandler: requireWorkspaceRole('viewer') },
    async (request) => {
      const parsed = ListReviewsQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.issues, 'The query string is invalid.');
      }
      const { status, author, limit, cursor: rawCursor } = parsed.data;

      const cursor = rawCursor === undefined ? undefined : decodeCursor(rawCursor);
      if (cursor === null) throw new InvalidCursorError();

      return listReviews(app.db, requestWorkspace(request).id, {
        status,
        authorId: author === 'me' ? authUser(request).id : author,
        limit,
        cursor,
      });
    },
  );

  await app.register(singleReviewRoutes, { prefix: '/:reviewNumber' });
};
