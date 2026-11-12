import 'server-only';

import {
  AiFindingDtoSchema,
  AiJobSchema,
  ApprovalRulesSchema,
  CommentSchema,
  ErrorResponseSchema,
  ReviewDecisionSchema,
  ReviewerSchema,
  ReviewEventSchema,
  ReviewFileDiffSchema,
  ReviewFileSchema,
  ReviewListResponseSchema,
  ReviewSchema,
  ReviewStateSchema,
  WorkspaceMemberSchema,
  WorkspaceSchema,
  LatestAnalysisResponseSchema,
  ThreadSchema,
  UnreadCountResponseSchema,
  type AiFinding,
  type AiJob,
  type ApprovalRules,
  type AssignReviewersRequest,
  type Comment,
  type CreateThreadRequest,
  type Review,
  type ReviewDecision,
  type Reviewer,
  type ReviewEvent,
  type ReviewState,
  type SubmitDecisionRequest,
  type UpdateApprovalRulesRequest,
  type ReviewFile,
  type ReviewFileDiff,
  type ReviewListResponse,
  type Thread,
  type LatestAnalysisResponse,
  type ThreadStatus,
  type Workspace,
  type WorkspaceMember,
} from '@diffcraft/shared';
import { cookies } from 'next/headers';
import { z } from 'zod';
import { SESSION_COOKIE_NAME } from './auth.server';
import { env } from './env.server';
import { forwardedClientHeaders } from './forwarding.server';
import { toFieldErrors, type FieldErrors } from './form-errors';
import { isReviewNumber, isUuid, reviewListQuery, type ReviewFilters } from './review-params';

/** 0 when there was no usable response (network, timeout, bad body). */
export type ServerApiResult<T> = { ok: true; data: T } | { ok: false; status: number };

/** Never throws, so redirect() and notFound() stay in the page. */
export async function apiGet<T>(path: string, schema: z.ZodType<T>): Promise<ServerApiResult<T>> {
  // Outside fetchApi's try on purpose: during prerendering cookies() throws to mark the page dynamic, which must not be swallowed.
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  if (!token) return { ok: false, status: 401 };
  return fetchApi(env.API_URL, path, token, schema, fetch, await forwardedClientHeaders());
}

export async function fetchApi<T>(
  apiUrl: string,
  path: string,
  token: string,
  schema: z.ZodType<T>,
  fetchImpl: typeof fetch = fetch,
  forwarded: Record<string, string> = {},
): Promise<ServerApiResult<T>> {
  try {
    const res = await fetchImpl(new URL(path, apiUrl), {
      // Server-to-server, so the browser's cookie isn't sent automatically: forward it.
      headers: { ...forwarded, cookie: `${SESSION_COOKIE_NAME}=${token}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return { ok: false, status: res.status };

    const parsed = schema.safeParse(await res.json());
    return parsed.success ? { ok: true, data: parsed.data } : { ok: false, status: 0 };
  } catch {
    return { ok: false, status: 0 };
  }
}

const NOT_FOUND = { ok: false, status: 404 } as const;

export async function getUnreadNotificationCount(): Promise<ServerApiResult<number>> {
  const result = await apiGet('/api/v1/notifications/unread-count', UnreadCountResponseSchema);
  return result.ok ? { ok: true, data: result.data.count } : result;
}

export function getWorkspaces(): Promise<ServerApiResult<Workspace[]>> {
  return apiGet('/api/v1/workspaces', WorkspaceSchema.array());
}

export async function getWorkspace(workspaceId: string): Promise<ServerApiResult<Workspace>> {
  if (!isUuid(workspaceId)) return NOT_FOUND;
  return apiGet(`/api/v1/workspaces/${workspaceId}`, WorkspaceSchema);
}

export async function getMembers(workspaceId: string): Promise<ServerApiResult<WorkspaceMember[]>> {
  if (!isUuid(workspaceId)) return NOT_FOUND;
  return apiGet(`/api/v1/workspaces/${workspaceId}/members`, WorkspaceMemberSchema.array());
}

export async function getReviews(
  workspaceId: string,
  filters: ReviewFilters & { cursor?: string | null },
): Promise<ServerApiResult<ReviewListResponse>> {
  if (!isUuid(workspaceId)) return NOT_FOUND;
  const query = reviewListQuery(filters, filters.cursor);
  return apiGet(`/api/v1/workspaces/${workspaceId}/reviews${query}`, ReviewListResponseSchema);
}

export async function getReview(
  workspaceId: string,
  reviewNumber: string,
): Promise<ServerApiResult<Review>> {
  if (!isUuid(workspaceId) || !isReviewNumber(reviewNumber)) return NOT_FOUND;
  return apiGet(`/api/v1/workspaces/${workspaceId}/reviews/${reviewNumber}`, ReviewSchema);
}

export async function getReviewFiles(
  workspaceId: string,
  reviewNumber: string,
): Promise<ServerApiResult<ReviewFile[]>> {
  if (!isUuid(workspaceId) || !isReviewNumber(reviewNumber)) return NOT_FOUND;
  return apiGet(
    `/api/v1/workspaces/${workspaceId}/reviews/${reviewNumber}/files`,
    ReviewFileSchema.array(),
  );
}

export async function getReviewFileDiff(
  workspaceId: string,
  reviewNumber: string,
  fileId: string,
): Promise<ServerApiResult<ReviewFileDiff>> {
  if (!isUuid(workspaceId) || !isReviewNumber(reviewNumber) || !isUuid(fileId)) return NOT_FOUND;
  return apiGet(
    `/api/v1/workspaces/${workspaceId}/reviews/${reviewNumber}/files/${fileId}/diff`,
    ReviewFileDiffSchema,
  );
}

export async function getThreads(
  workspaceId: string,
  reviewNumber: string,
): Promise<ServerApiResult<Thread[]>> {
  if (!isUuid(workspaceId) || !isReviewNumber(reviewNumber)) return NOT_FOUND;
  return apiGet(
    `/api/v1/workspaces/${workspaceId}/reviews/${reviewNumber}/threads`,
    ThreadSchema.array(),
  );
}

function reviewPath(workspaceId: string, reviewNumber: string): string | null {
  return isUuid(workspaceId) && isReviewNumber(reviewNumber)
    ? `/api/v1/workspaces/${workspaceId}/reviews/${reviewNumber}`
    : null;
}

function getFromReview<T>(
  workspaceId: string,
  reviewNumber: string,
  rest: string,
  schema: z.ZodType<T>,
): Promise<ServerApiResult<T>> {
  const base = reviewPath(workspaceId, reviewNumber);
  return base ? apiGet(`${base}${rest}`, schema) : Promise.resolve(NOT_FOUND);
}

export const getReviewState = (workspaceId: string, reviewNumber: string) =>
  getFromReview<ReviewState>(workspaceId, reviewNumber, '/state', ReviewStateSchema);

export const getReviewers = (workspaceId: string, reviewNumber: string) =>
  getFromReview<Reviewer[]>(workspaceId, reviewNumber, '/reviewers', ReviewerSchema.array());

export const getDecisions = (workspaceId: string, reviewNumber: string) =>
  getFromReview<ReviewDecision[]>(
    workspaceId,
    reviewNumber,
    '/decisions',
    ReviewDecisionSchema.array(),
  );

export const getReviewEvents = (workspaceId: string, reviewNumber: string) =>
  getFromReview<ReviewEvent[]>(workspaceId, reviewNumber, '/events', ReviewEventSchema.array());

export const getLatestAnalysis = (workspaceId: string, reviewNumber: string) =>
  getFromReview<LatestAnalysisResponse>(
    workspaceId,
    reviewNumber,
    '/analyses/latest',
    LatestAnalysisResponseSchema,
  );

export async function getRules(workspaceId: string): Promise<ServerApiResult<ApprovalRules>> {
  if (!isUuid(workspaceId)) return NOT_FOUND;
  return apiGet(`/api/v1/workspaces/${workspaceId}/rules`, ApprovalRulesSchema);
}

export interface ServerSendFailure {
  ok: false;
  status: number;
  code: string | null;
  fieldErrors: FieldErrors;
  details?: unknown;
  retryAfterSeconds?: number;
}
export type ServerSendResult<T> = { ok: true; data: T } | ServerSendFailure;

const sendFailure = (status: number, code: string | null = null): ServerSendFailure => ({
  ok: false,
  status,
  code,
  fieldErrors: {},
});

const FieldIssuesSchema = z.array(z.object({ field: z.string(), message: z.string() }));

type SendMethod = 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export async function apiSend<T>(
  method: SendMethod,
  path: string,
  body: unknown,
  schema: z.ZodType<T>,
): Promise<ServerSendResult<T>> {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  if (!token) return sendFailure(401, 'unauthenticated');
  const forwarded = await forwardedClientHeaders();
  return sendApi(env.API_URL, method, path, token, body, schema, fetch, forwarded);
}

export async function sendApi<T>(
  apiUrl: string,
  method: SendMethod,
  path: string,
  token: string,
  body: unknown,
  schema: z.ZodType<T>,
  fetchImpl: typeof fetch = fetch,
  forwarded: Record<string, string> = {},
): Promise<ServerSendResult<T>> {
  try {
    const res = await fetchImpl(new URL(path, apiUrl), {
      method,
      headers: {
        ...forwarded,
        cookie: `${SESSION_COOKIE_NAME}=${token}`,
        ...(body !== undefined && { 'content-type': 'application/json' }),
      },
      ...(body !== undefined && { body: JSON.stringify(body) }),
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    });
    const json: unknown = await res.json().catch(() => undefined);

    if (!res.ok) {
      const error = ErrorResponseSchema.safeParse(json);
      if (!error.success) return sendFailure(res.status);
      const issues =
        res.status === 422 ? FieldIssuesSchema.safeParse(error.data.error.details) : null;
      const { code, details } = error.data.error;
      const retryAfter = Number(res.headers.get('retry-after'));
      return {
        ...sendFailure(res.status, code),
        fieldErrors: issues?.success ? toFieldErrors(issues.data) : {},
        ...(details !== undefined && { details }),
        ...(Number.isSafeInteger(retryAfter) &&
          retryAfter > 0 && { retryAfterSeconds: retryAfter }),
      };
    }
    const parsed = schema.safeParse(json);
    return parsed.success ? { ok: true, data: parsed.data } : sendFailure(0);
  } catch {
    return sendFailure(0);
  }
}

// Thread endpoints. Ids are checked before they are put in a path (see isUuid).
const SEND_NOT_FOUND = sendFailure(404);

function threadsPath(workspaceId: string, reviewNumber: string): string | null {
  return isUuid(workspaceId) && isReviewNumber(reviewNumber)
    ? `/api/v1/workspaces/${workspaceId}/reviews/${reviewNumber}/threads`
    : null;
}

export async function postThread(
  workspaceId: string,
  reviewNumber: string,
  input: CreateThreadRequest,
): Promise<ServerSendResult<Thread>> {
  const base = threadsPath(workspaceId, reviewNumber);
  if (!base) return SEND_NOT_FOUND;
  return apiSend('POST', base, input, ThreadSchema);
}

export async function patchThreadStatus(
  workspaceId: string,
  reviewNumber: string,
  threadId: string,
  status: ThreadStatus,
): Promise<ServerSendResult<Thread>> {
  const base = threadsPath(workspaceId, reviewNumber);
  if (!base || !isUuid(threadId)) return SEND_NOT_FOUND;
  return apiSend('PATCH', `${base}/${threadId}`, { status }, ThreadSchema);
}

export async function postReply(
  workspaceId: string,
  reviewNumber: string,
  threadId: string,
  body: string,
): Promise<ServerSendResult<Comment>> {
  const base = threadsPath(workspaceId, reviewNumber);
  if (!base || !isUuid(threadId)) return SEND_NOT_FOUND;
  return apiSend('POST', `${base}/${threadId}/comments`, { body }, CommentSchema);
}

export async function patchComment(
  workspaceId: string,
  reviewNumber: string,
  threadId: string,
  commentId: string,
  body: string,
): Promise<ServerSendResult<Comment>> {
  const base = threadsPath(workspaceId, reviewNumber);
  if (!base || !isUuid(threadId) || !isUuid(commentId)) return SEND_NOT_FOUND;
  return apiSend('PATCH', `${base}/${threadId}/comments/${commentId}`, { body }, CommentSchema);
}

export async function deleteCommentRequest(
  workspaceId: string,
  reviewNumber: string,
  threadId: string,
  commentId: string,
): Promise<ServerSendResult<Comment>> {
  const base = threadsPath(workspaceId, reviewNumber);
  if (!base || !isUuid(threadId) || !isUuid(commentId)) return SEND_NOT_FOUND;
  return apiSend('DELETE', `${base}/${threadId}/comments/${commentId}`, undefined, CommentSchema);
}

export async function postReviewers(
  workspaceId: string,
  reviewNumber: string,
  input: AssignReviewersRequest,
): Promise<ServerSendResult<Reviewer[]>> {
  const base = reviewPath(workspaceId, reviewNumber);
  if (!base) return SEND_NOT_FOUND;
  return apiSend('POST', `${base}/reviewers`, input, ReviewerSchema.array());
}

export async function deleteReviewerRequest(
  workspaceId: string,
  reviewNumber: string,
  userId: string,
): Promise<ServerSendResult<undefined>> {
  const base = reviewPath(workspaceId, reviewNumber);
  if (!base || !isUuid(userId)) return SEND_NOT_FOUND;
  return apiSend('DELETE', `${base}/reviewers/${userId}`, undefined, z.undefined());
}

export async function postDecision(
  workspaceId: string,
  reviewNumber: string,
  input: SubmitDecisionRequest,
): Promise<ServerSendResult<ReviewDecision>> {
  const base = reviewPath(workspaceId, reviewNumber);
  if (!base) return SEND_NOT_FOUND;
  return apiSend('POST', `${base}/decisions`, input, ReviewDecisionSchema);
}

export async function postMerge(
  workspaceId: string,
  reviewNumber: string,
): Promise<ServerSendResult<Review>> {
  const base = reviewPath(workspaceId, reviewNumber);
  if (!base) return SEND_NOT_FOUND;
  return apiSend('POST', `${base}/merge`, undefined, ReviewSchema);
}

export async function patchRules(
  workspaceId: string,
  input: UpdateApprovalRulesRequest,
): Promise<ServerSendResult<ApprovalRules>> {
  if (!isUuid(workspaceId)) return SEND_NOT_FOUND;
  return apiSend('PATCH', `/api/v1/workspaces/${workspaceId}/rules`, input, ApprovalRulesSchema);
}

export async function postAnalysis(
  workspaceId: string,
  reviewNumber: string,
): Promise<ServerSendResult<AiJob>> {
  const base = reviewPath(workspaceId, reviewNumber);
  if (!base) return SEND_NOT_FOUND;
  return apiSend('POST', `${base}/analyses`, undefined, AiJobSchema);
}

export async function postDismissFinding(
  workspaceId: string,
  reviewNumber: string,
  findingId: string,
): Promise<ServerSendResult<AiFinding>> {
  const base = reviewPath(workspaceId, reviewNumber);
  if (!base || !isUuid(findingId)) return SEND_NOT_FOUND;
  return apiSend('POST', `${base}/findings/${findingId}/dismiss`, undefined, AiFindingDtoSchema);
}

export async function sendFindingFeedback(
  workspaceId: string,
  reviewNumber: string,
  findingId: string,
  helpful: boolean | null,
): Promise<ServerSendResult<AiFinding>> {
  const base = reviewPath(workspaceId, reviewNumber);
  if (!base || !isUuid(findingId)) return SEND_NOT_FOUND;
  const path = `${base}/findings/${findingId}/feedback`;
  return helpful === null
    ? apiSend('DELETE', path, undefined, AiFindingDtoSchema)
    : apiSend('PUT', path, { helpful }, AiFindingDtoSchema);
}
