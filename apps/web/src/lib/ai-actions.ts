'use server';

import type { AiFinding, AiJob, LatestAnalysisResponse } from '@diffcraft/shared';
import { z } from 'zod';
import {
  getLatestAnalysis,
  postAnalysis,
  postDismissFinding,
  sendFindingFeedback,
  type ServerSendResult,
} from './api.server';
import { NOT_FOUND_ERROR, toAiError, type AiActionResult } from './ai-errors';
import { isReviewNumber, isUuid } from './review-params';

// Public endpoints callable with any arguments: every argument is checked here; the API checks access with the user's cookie.

const isId = (value: unknown): value is string => typeof value === 'string' && isUuid(value);
const isNumber = (value: unknown): value is string =>
  typeof value === 'string' && isReviewNumber(value);

const notFound = { ok: false as const, error: NOT_FOUND_ERROR };
const findingNotFound = {
  ok: false as const,
  error: {
    code: 'not_found' as const,
    message: 'This finding no longer exists. Refresh the page.',
  },
};

const FeedbackInputSchema = z.object({ helpful: z.boolean().nullable() });

function fromApi<T>(result: ServerSendResult<T>): AiActionResult<T> {
  return result.ok ? result : { ok: false, error: toAiError(result) };
}

export async function runAnalysis(
  workspaceId: unknown,
  reviewNumber: unknown,
): Promise<AiActionResult<AiJob>> {
  if (!isId(workspaceId) || !isNumber(reviewNumber)) return notFound;
  return fromApi(await postAnalysis(workspaceId, reviewNumber));
}

export interface LoadedAnalysis {
  latest: LatestAnalysisResponse;
  loadedAt: string;
}

export async function loadLatestAnalysis(
  workspaceId: unknown,
  reviewNumber: unknown,
): Promise<AiActionResult<LoadedAnalysis>> {
  if (!isId(workspaceId) || !isNumber(reviewNumber)) return notFound;
  // Taken before the request, so the result is at least this new.
  const loadedAt = new Date().toISOString();
  const result = await getLatestAnalysis(workspaceId, reviewNumber);
  if (!result.ok) {
    return { ok: false, error: toAiError({ ...result, code: null, fieldErrors: {} }) };
  }
  return { ok: true, data: { latest: result.data, loadedAt } };
}

export async function dismissFinding(
  workspaceId: unknown,
  reviewNumber: unknown,
  findingId: unknown,
): Promise<AiActionResult<AiFinding>> {
  if (!isId(workspaceId) || !isNumber(reviewNumber)) return notFound;
  if (!isId(findingId)) return findingNotFound;
  return fromApi(await postDismissFinding(workspaceId, reviewNumber, findingId));
}

export async function setFindingFeedback(
  workspaceId: unknown,
  reviewNumber: unknown,
  findingId: unknown,
  input: unknown,
): Promise<AiActionResult<AiFinding>> {
  if (!isId(workspaceId) || !isNumber(reviewNumber)) return notFound;
  if (!isId(findingId)) return findingNotFound;
  const parsed = FeedbackInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: { code: 'invalid', message: 'Choose helpful or not helpful.' } };
  }
  return fromApi(
    await sendFindingFeedback(workspaceId, reviewNumber, findingId, parsed.data.helpful),
  );
}
