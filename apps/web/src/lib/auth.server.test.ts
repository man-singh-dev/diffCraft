import { beforeEach, describe, expect, it, vi } from 'vitest';

// server-only throws outside a React Server Components build; cookies() needs a request.
vi.mock('server-only', () => ({}));
const cookieStore = { get: vi.fn<(name: string) => { value: string } | undefined>() };
vi.mock('next/headers', () => ({ cookies: () => Promise.resolve(cookieStore) }));

const { fetchCurrentUser, getCurrentUser, SESSION_COOKIE_NAME } = await import('./auth.server.js');

const USER = {
  id: '01a17e5e-aa56-7985-be46-bf5f1c7e7fde',
  email: 'ada@example.com',
  displayName: 'Ada',
  createdAt: '2026-10-27T17:18:15.633Z',
};
const API_URL = 'http://api.test.invalid';
const TOKEN = 'a'.repeat(43);

const makeFetch = (status: number, body: unknown) =>
  vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(body), { status }));

describe('fetchCurrentUser', () => {
  it('calls /me with the session cookie forwarded, uncached, and returns the user', async () => {
    const fetchImpl = makeFetch(200, USER);
    expect(await fetchCurrentUser(API_URL, TOKEN, fetchImpl)).toEqual(USER);

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toBe(`${API_URL}/api/v1/auth/me`);
    expect(new Headers(init?.headers).get('cookie')).toBe(`diffcraft_session=${TOKEN}`);
    expect(init?.cache).toBe('no-store');
  });

  it('returns null on 401', async () => {
    const body = { error: { code: 'unauthenticated', message: 'Authentication required.' } };
    expect(await fetchCurrentUser(API_URL, TOKEN, makeFetch(401, body))).toBeNull();
  });

  it('returns null for a 200 with an unexpected body', async () => {
    expect(await fetchCurrentUser(API_URL, TOKEN, makeFetch(200, { id: 'x' }))).toBeNull();
  });

  it('returns null when the body is not JSON', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response('oops'));
    expect(await fetchCurrentUser(API_URL, TOKEN, fetchImpl)).toBeNull();
  });

  it('returns null instead of throwing when the API is unreachable', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('fetch failed'));
    expect(await fetchCurrentUser(API_URL, TOKEN, fetchImpl)).toBeNull();
  });
});

describe('getCurrentUser', () => {
  beforeEach(() => {
    cookieStore.get.mockReset();
  });

  it('returns null without calling the API when there is no session cookie', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    cookieStore.get.mockReturnValue(undefined);

    expect(await getCurrentUser()).toBeNull();
    expect(cookieStore.get).toHaveBeenCalledWith(SESSION_COOKIE_NAME);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
