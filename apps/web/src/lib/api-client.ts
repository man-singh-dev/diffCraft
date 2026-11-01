import {
  ErrorResponseSchema,
  PublicUserSchema,
  ReviewListResponseSchema,
  ReviewSchema,
  WorkspaceMemberSchema,
  WorkspaceSchema,
  type AddMemberRequest,
  type CreateReviewRequest,
  type CreateWorkspaceRequest,
  type LoginRequest,
  type PublicUser,
  type RegisterRequest,
  type Review,
  type ReviewListResponse,
  type UpdateMemberRoleRequest,
  type UpdateReviewRequest,
  type UpdateWorkspaceRequest,
  type Workspace,
  type WorkspaceMember,
} from '@diffcraft/shared';
import { z } from 'zod';
import { toFieldErrors, type FieldErrors } from './form-errors';
import { reviewListQuery, type ReviewFilters } from './review-params';

// Browser-side calls to the API. Only relative URLs: next.config.ts forwards /api/* to the API.

export interface ApiFailure {
  ok: false;
  /** HTTP status, or 0 if the request never got a response. */
  status: number;
  code: string;
  message: string;
  fieldErrors: FieldErrors;
  /** error.details, for codes that carry more than a message (e.g. invalid_patch). */
  details?: unknown;
}
export type ApiResult<T> = { ok: true; data: T } | ApiFailure;

// error.details of a 422 (see ValidationError in apps/api/src/errors.ts).
const FieldIssuesSchema = z.array(z.object({ field: z.string(), message: z.string() }));

const failure = (status: number, code: string, message: string): ApiFailure => ({
  ok: false,
  status,
  code,
  message,
  fieldErrors: {},
});

const unexpected = (status: number) =>
  failure(status, 'unexpected_response', 'Something went wrong. Please try again.');

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

/** `schema` null means no response body is expected (e.g. 204). */
async function request<T>(
  method: Method,
  path: string,
  body: unknown,
  schema: z.ZodType<T> | null,
  fetchImpl: typeof fetch,
): Promise<ApiResult<T>> {
  let res: Response;
  try {
    res = await fetchImpl(path, {
      method,
      ...(body !== undefined && {
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
    });
  } catch {
    return failure(
      0,
      'network_error',
      "Couldn't reach the server. Check your connection and try again.",
    );
  }

  const json: unknown = schema || !res.ok ? await res.json().catch(() => undefined) : undefined;

  if (!res.ok) {
    const parsed = ErrorResponseSchema.safeParse(json);
    if (!parsed.success) return unexpected(res.status);

    const { code, message, details } = parsed.data.error;
    const issues = res.status === 422 ? FieldIssuesSchema.safeParse(details) : null;
    return {
      ...failure(res.status, code, message),
      fieldErrors: issues?.success ? toFieldErrors(issues.data) : {},
      ...(details !== undefined && res.status !== 422 && { details }),
    };
  }

  if (!schema) return { ok: true, data: undefined as T };
  const parsed = schema.safeParse(json);
  return parsed.success ? { ok: true, data: parsed.data } : unexpected(res.status);
}

export function register(
  input: RegisterRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<ApiResult<PublicUser>> {
  return request('POST', '/api/v1/auth/register', input, PublicUserSchema, fetchImpl);
}

export function login(
  input: LoginRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<ApiResult<PublicUser>> {
  return request('POST', '/api/v1/auth/login', input, PublicUserSchema, fetchImpl);
}

export function logout(fetchImpl: typeof fetch = fetch): Promise<ApiResult<void>> {
  return request<void>('POST', '/api/v1/auth/logout', undefined, null, fetchImpl);
}

// Ids come from API responses, but are encoded anyway so a path can never be rewritten.
const workspacePath = (workspaceId: string) =>
  `/api/v1/workspaces/${encodeURIComponent(workspaceId)}`;
const memberPath = (workspaceId: string, userId: string) =>
  `${workspacePath(workspaceId)}/members/${encodeURIComponent(userId)}`;

export function createWorkspace(
  input: CreateWorkspaceRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<ApiResult<Workspace>> {
  return request('POST', '/api/v1/workspaces', input, WorkspaceSchema, fetchImpl);
}

export function renameWorkspace(
  workspaceId: string,
  input: UpdateWorkspaceRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<ApiResult<Workspace>> {
  return request('PATCH', workspacePath(workspaceId), input, WorkspaceSchema, fetchImpl);
}

export function deleteWorkspace(
  workspaceId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ApiResult<void>> {
  return request<void>('DELETE', workspacePath(workspaceId), undefined, null, fetchImpl);
}

export function addMember(
  workspaceId: string,
  input: AddMemberRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<ApiResult<WorkspaceMember>> {
  const path = `${workspacePath(workspaceId)}/members`;
  return request('POST', path, input, WorkspaceMemberSchema, fetchImpl);
}

export function changeMemberRole(
  workspaceId: string,
  userId: string,
  input: UpdateMemberRoleRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<ApiResult<WorkspaceMember>> {
  const path = memberPath(workspaceId, userId);
  return request('PATCH', path, input, WorkspaceMemberSchema, fetchImpl);
}

export function removeMember(
  workspaceId: string,
  userId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ApiResult<void>> {
  return request<void>('DELETE', memberPath(workspaceId, userId), undefined, null, fetchImpl);
}

export function leaveWorkspace(
  workspaceId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ApiResult<void>> {
  const path = `${workspacePath(workspaceId)}/members/leave`;
  return request<void>('POST', path, undefined, null, fetchImpl);
}

const reviewsPath = (workspaceId: string) => `${workspacePath(workspaceId)}/reviews`;
const reviewPath = (workspaceId: string, reviewNumber: number) =>
  `${reviewsPath(workspaceId)}/${encodeURIComponent(reviewNumber)}`;

/** One page of reviews, for "Load more" (the first page is rendered on the server). */
export function listReviews(
  workspaceId: string,
  filters: ReviewFilters,
  cursor: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ApiResult<ReviewListResponse>> {
  const path = `${reviewsPath(workspaceId)}${reviewListQuery(filters, cursor)}`;
  return request('GET', path, undefined, ReviewListResponseSchema, fetchImpl);
}

export function createReview(
  workspaceId: string,
  input: CreateReviewRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<ApiResult<Review>> {
  return request('POST', reviewsPath(workspaceId), input, ReviewSchema, fetchImpl);
}

export function updateReview(
  workspaceId: string,
  reviewNumber: number,
  input: UpdateReviewRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<ApiResult<Review>> {
  return request('PATCH', reviewPath(workspaceId, reviewNumber), input, ReviewSchema, fetchImpl);
}

export function deleteReview(
  workspaceId: string,
  reviewNumber: number,
  fetchImpl: typeof fetch = fetch,
): Promise<ApiResult<void>> {
  return request<void>('DELETE', reviewPath(workspaceId, reviewNumber), undefined, null, fetchImpl);
}
