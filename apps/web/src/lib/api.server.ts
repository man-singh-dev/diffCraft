import 'server-only';

import {
  WorkspaceMemberSchema,
  WorkspaceSchema,
  type Workspace,
  type WorkspaceMember,
} from '@diffcraft/shared';
import { cookies } from 'next/headers';
import { z } from 'zod';
import { SESSION_COOKIE_NAME } from './auth.server';
import { env } from './env.server';

/** `status` is the HTTP status, or 0 when there was no usable response (network, timeout, bad body). */
export type ServerApiResult<T> = { ok: true; data: T } | { ok: false; status: number };

/**
 * GET `path` on the API as the current user. No session cookie is a 401 without calling the API.
 * Never throws, so redirect() and notFound() stay in the page.
 */
export async function apiGet<T>(path: string, schema: z.ZodType<T>): Promise<ServerApiResult<T>> {
  // Outside fetchApi's try on purpose: during prerendering cookies() throws to tell Next.js the
  // page is dynamic, and that signal must not be swallowed.
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  if (!token) return { ok: false, status: 401 };
  return fetchApi(env.API_URL, path, token, schema);
}

/** The request behind apiGet. Never throws. */
export async function fetchApi<T>(
  apiUrl: string,
  path: string,
  token: string,
  schema: z.ZodType<T>,
  fetchImpl: typeof fetch = fetch,
): Promise<ServerApiResult<T>> {
  try {
    const res = await fetchImpl(new URL(path, apiUrl), {
      // Server-to-server, so the browser's cookie isn't sent automatically: forward it.
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
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

// The id comes from the URL. Only a UUID is put in the path: encodeURIComponent leaves "." and
// "..", which new URL() would resolve into a different API path. The API 404s the rest anyway.
const isUuid = (id: string) => z.uuid().safeParse(id).success;
const NOT_FOUND = { ok: false, status: 404 } as const;

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
