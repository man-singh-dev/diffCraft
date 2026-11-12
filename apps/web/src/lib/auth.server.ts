import 'server-only';

import { PublicUserSchema, type PublicUser } from '@diffcraft/shared';
import { cookies } from 'next/headers';
import { cache } from 'react';
import { env } from './env.server';
import { forwardedClientHeaders } from './forwarding.server';

// Must match SESSION_COOKIE_NAME in apps/api/src/modules/auth/session.ts.
export const SESSION_COOKIE_NAME = 'diffcraft_session';

// Per request: the (app) layout and its page both ask, and should share one /me call.
export const getCurrentUser = cache(async (): Promise<PublicUser | null> => {
  // Outside the try on purpose: during prerendering cookies() throws to mark the page dynamic, which must not be swallowed.
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;
  return fetchCurrentUser(env.API_URL, token, fetch, await forwardedClientHeaders());
});

export async function fetchCurrentUser(
  apiUrl: string,
  token: string,
  fetchImpl: typeof fetch = fetch,
  forwarded: Record<string, string> = {},
): Promise<PublicUser | null> {
  try {
    const res = await fetchImpl(new URL('/api/v1/auth/me', apiUrl), {
      // Server-to-server, so the browser's cookie isn't sent automatically: forward it.
      headers: { ...forwarded, cookie: `${SESSION_COOKIE_NAME}=${token}` },
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
