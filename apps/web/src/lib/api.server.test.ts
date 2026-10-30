import { WorkspaceSchema } from '@diffcraft/shared';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

// server-only throws outside a React Server Components build; cookies() needs a request.
vi.mock('server-only', () => ({}));
const cookieStore = { get: vi.fn<(name: string) => { value: string } | undefined>() };
vi.mock('next/headers', () => ({ cookies: () => Promise.resolve(cookieStore) }));

const { fetchApi, getMembers, getWorkspace, getWorkspaces } = await import('./api.server.js');

const API_URL = 'http://api.test.invalid';
const TOKEN = 'a'.repeat(43);
const WORKSPACE = {
  id: '01a17e5e-aa56-7985-be46-bf5f1c7e7fd0',
  name: 'Team',
  slug: 'team',
  createdAt: '2026-10-27T17:18:15.633Z',
  role: 'owner',
};

const makeFetch = (status: number, body: unknown) =>
  vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(body), { status }));

describe('fetchApi', () => {
  it('forwards the session cookie, uncached, with a timeout, and returns the parsed body', async () => {
    const fetchImpl = makeFetch(200, WORKSPACE);
    const path = `/api/v1/workspaces/${WORKSPACE.id}`;

    expect(await fetchApi(API_URL, path, TOKEN, WorkspaceSchema, fetchImpl)).toEqual({
      ok: true,
      data: WORKSPACE,
    });
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toBe(`${API_URL}${path}`);
    expect(new Headers(init?.headers).get('cookie')).toBe(`diffcraft_session=${TOKEN}`);
    expect(init?.cache).toBe('no-store');
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it.each([401, 403, 404, 500])('returns the status of a %i', async (status) => {
    const body = { error: { code: 'x', message: 'x' } };
    expect(await fetchApi(API_URL, '/x', TOKEN, WorkspaceSchema, makeFetch(status, body))).toEqual({
      ok: false,
      status,
    });
  });

  it('returns status 0 for a 200 with the wrong shape', async () => {
    const fetchImpl = makeFetch(200, { ...WORKSPACE, role: 'superadmin' });
    expect(await fetchApi(API_URL, '/x', TOKEN, WorkspaceSchema, fetchImpl)).toEqual({
      ok: false,
      status: 0,
    });
  });

  it('returns status 0 for a body that is not JSON', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response('<html>'));
    expect(await fetchApi(API_URL, '/x', TOKEN, WorkspaceSchema, fetchImpl)).toEqual({
      ok: false,
      status: 0,
    });
  });

  it('returns status 0 instead of throwing when the API is unreachable or times out', async () => {
    for (const error of [
      new TypeError('fetch failed'),
      new DOMException('timed out', 'TimeoutError'),
    ]) {
      const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(error);
      expect(await fetchApi(API_URL, '/x', TOKEN, WorkspaceSchema, fetchImpl)).toEqual({
        ok: false,
        status: 0,
      });
    }
  });
});

describe('getWorkspaces, getWorkspace and getMembers', () => {
  const fetchSpy = vi.spyOn(globalThis, 'fetch');

  beforeEach(() => {
    cookieStore.get.mockReset();
    fetchSpy.mockClear();
  });

  afterAll(() => {
    fetchSpy.mockRestore();
  });

  it('returns 401 without calling the API when there is no session cookie', async () => {
    cookieStore.get.mockReturnValue(undefined);

    expect(await getWorkspaces()).toEqual({ ok: false, status: 401 });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each(['..', '.', 'abc', '../auth/me'])(
    'returns 404 without calling the API for the id %j',
    async (id) => {
      cookieStore.get.mockReturnValue({ value: TOKEN });

      expect(await getWorkspace(id)).toEqual({ ok: false, status: 404 });
      expect(await getMembers(id)).toEqual({ ok: false, status: 404 });
      expect(fetchSpy).not.toHaveBeenCalled();
    },
  );
});
