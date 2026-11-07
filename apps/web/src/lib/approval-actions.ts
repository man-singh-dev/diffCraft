'use server';

import {
  AssignReviewersRequestSchema,
  SubmitDecisionRequestSchema,
  UpdateApprovalRulesRequestSchema,
  type ApprovalRules,
  type Review,
  type ReviewDecision,
  type Reviewer,
} from '@diffcraft/shared';
import {
  deleteReviewerRequest,
  patchRules,
  postDecision,
  postMerge,
  postReviewers,
  type ServerSendResult,
} from './api.server';
import { NOT_FOUND_ERROR, toApprovalError, type ApprovalActionResult } from './approval-errors';
import { validateForm } from './form-errors';
import { isReviewNumber, isUuid } from './review-params';

// Public endpoints callable with any arguments: every argument is checked here; the API checks access with the user's cookie.

const isId = (value: unknown): value is string => typeof value === 'string' && isUuid(value);
const isNumber = (value: unknown): value is string =>
  typeof value === 'string' && isReviewNumber(value);

const notFound = { ok: false as const, error: NOT_FOUND_ERROR };

function fromApi<T>(result: ServerSendResult<T>): ApprovalActionResult<T> {
  return result.ok ? result : { ok: false, error: toApprovalError(result) };
}

export async function assignReviewers(
  workspaceId: unknown,
  reviewNumber: unknown,
  input: unknown,
): Promise<ApprovalActionResult<Reviewer[]>> {
  if (!isId(workspaceId) || !isNumber(reviewNumber)) return notFound;
  const parsed = AssignReviewersRequestSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: { code: 'invalid', message: 'Choose up to 10 people to add.' } };
  }
  return fromApi(await postReviewers(workspaceId, reviewNumber, parsed.data));
}

export async function removeReviewer(
  workspaceId: unknown,
  reviewNumber: unknown,
  userId: unknown,
): Promise<ApprovalActionResult<null>> {
  if (!isId(workspaceId) || !isNumber(reviewNumber) || !isId(userId)) return notFound;
  const result = await deleteReviewerRequest(workspaceId, reviewNumber, userId);
  return result.ok ? { ok: true, data: null } : fromApi(result);
}

export async function submitDecision(
  workspaceId: unknown,
  reviewNumber: unknown,
  input: unknown,
): Promise<ApprovalActionResult<ReviewDecision>> {
  if (!isId(workspaceId) || !isNumber(reviewNumber)) return notFound;
  const normalized =
    input && typeof input === 'object' && 'body' in input && typeof input.body === 'string'
      ? { ...input, body: input.body.trim() || undefined }
      : input;
  const parsed = validateForm(SubmitDecisionRequestSchema, normalized);
  if (!parsed.success) {
    const bodyError = parsed.fieldErrors.body;
    return {
      ok: false,
      error: {
        code: 'invalid',
        message: bodyError ?? 'Choose approve or request changes.',
        fieldErrors: parsed.fieldErrors,
      },
    };
  }
  return fromApi(await postDecision(workspaceId, reviewNumber, parsed.data));
}

export async function mergeReview(
  workspaceId: unknown,
  reviewNumber: unknown,
): Promise<ApprovalActionResult<Review>> {
  if (!isId(workspaceId) || !isNumber(reviewNumber)) return notFound;
  return fromApi(await postMerge(workspaceId, reviewNumber));
}

export async function updateRules(
  workspaceId: unknown,
  input: unknown,
): Promise<ApprovalActionResult<ApprovalRules>> {
  if (!isId(workspaceId)) {
    return { ok: false, error: { code: 'not_found', message: "This workspace doesn't exist." } };
  }
  const parsed = validateForm(UpdateApprovalRulesRequestSchema, input);
  if (!parsed.success) {
    return {
      ok: false,
      error: {
        code: 'invalid',
        message: 'Required approvals must be a whole number from 0 to 10.',
        fieldErrors: parsed.fieldErrors,
      },
    };
  }
  return fromApi(await patchRules(workspaceId, parsed.data));
}
