import type { Review } from '@diffcraft/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { requestWorkspace } from '../workspaces/require-workspace-role.js';
import { ReviewNotFoundError } from './errors.js';
import { getReviewByNumber } from './service.js';

const MAX_INT4 = 2_147_483_647;
const REVIEW_NUMBER_PATTERN = /^[1-9]\d{0,9}$/;

/**
 * :reviewNumber from the URL. Anything but a positive int4 is a 404 before any query: Postgres
 * would reject a larger number with an error instead of finding nothing.
 */
export function reviewNumberParam(request: FastifyRequest): number {
  const { reviewNumber } = request.params as { reviewNumber?: string };
  const number =
    reviewNumber && REVIEW_NUMBER_PATTERN.test(reviewNumber) ? Number(reviewNumber) : 0;
  if (number < 1 || number > MAX_INT4) throw new ReviewNotFoundError();
  return number;
}

/** The review named in the URL, looked up in the URL's workspace (already checked by the guard). */
export async function loadReview(app: FastifyInstance, request: FastifyRequest): Promise<Review> {
  const review = await getReviewByNumber(
    app.db,
    requestWorkspace(request).id,
    reviewNumberParam(request),
  );
  if (!review) throw new ReviewNotFoundError();
  return review;
}
