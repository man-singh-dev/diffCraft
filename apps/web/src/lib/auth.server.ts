import 'server-only';

import { PublicUserSchema, type PublicUser } from '@diffcraft/shared';
import { cookies } from 'next/headers';
import { env } from './env.server';

// Must match SESSION_COOKIE_NAME in apps/api/src/modules/auth/session.ts.
export const SESSION_COOKIE_NAME = 'diffcraft_session';

/**
 * The logged-in user for the current request, or null. A missing cookie, a 401, an
 * unreachable API and an unexpected body all mean "not logged in".
 */
export async function getCurrentUser(): Promise<PublicUser | null> {
  // Outside the try in fetchCurrentUser on purpose: during prerendering cookies() throws to
  // tell Next.js the page is dynamic, and that signal must not be swallowed.
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;
  return fetchCurrentUser(env.API_URL, token);
}

/** The GET /me call behind getCurrentUser. Never throws. */
export async function fetchCurrentUser(
  apiUrl: string,
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<PublicUser | null> {
  try {
    const res = await fetchImpl(new URL('/api/v1/auth/me', apiUrl), {
      // Server-to-server, so the browser's cookie isn't sent automatically: forward it.
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return null;

    const parsed = PublicUserSchema.safeParse(await res.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
