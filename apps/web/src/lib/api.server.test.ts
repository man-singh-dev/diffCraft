import { WorkspaceSchema } from '@diffcraft/shared';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from 'vitest';

// server-only throws outside a React Server Components build; cookies() needs a request.
vi.mock('server-only', () => ({}));
const cookieStore = { get: vi.fn<(name: string) => { value: string } | undefined>() };
vi.mock('next/headers', () => ({ cookies: () => Promise.resolve(cookieStore) }));

const {
  fetchApi,
  getDecisions,
  getMembers,
  getReview,
  getReviewers,
  getReviewEvents,
  getReviewFiles,
  getReviews,
  getReviewState,
  getRules,
  getWorkspace,
  getWorkspaces,
  sendApi,
} = await import('./api.server.js');

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

describe('getReviews, getReview and getReviewFiles', () => {
  // Created in beforeAll: the block above restores its fetch spy when it ends.
  let fetchSpy: MockInstance<typeof fetch>;
  const REVIEW = {
    id: '01a17e5e-aa56-7985-be46-bf5f1c7e7fd3',
    workspaceId: WORKSPACE.id,
    number: 7,
    title: 'Fix login',
    description: 'Line one\nLine two',
    status: 'open',
    author: null,
    filesChanged: 1,
    additions: 1,
    deletions: 0,
    createdAt: '2026-10-27T17:18:15.633Z',
  };
  const FILE = {
    id: '01a17e5e-aa56-7985-be46-bf5f1c7e7fd4',
    position: 0,
    oldPath: null,
    newPath: 'src/new.ts',
    changeType: 'added',
    isBinary: false,
    additions: 1,
    deletions: 0,
  };
  const respond = (status: number, body: unknown) =>
    fetchSpy.mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify(body), { status })),
    );
  const calledPath = () => {
    const url = new URL(String(fetchSpy.mock.calls[0]![0]));
    return `${url.pathname}${url.search}`;
  };

  beforeAll(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  beforeEach(() => {
    cookieStore.get.mockReset();
    cookieStore.get.mockReturnValue({ value: TOKEN });
    fetchSpy.mockReset();
  });

  afterAll(() => {
    fetchSpy.mockRestore();
  });

  it('getReviews sends the filters (mine as author=me) and parses the page', async () => {
    const page = { items: [REVIEW], nextCursor: 'next' };
    respond(200, page);
    expect(
      await getReviews(WORKSPACE.id, { status: 'closed', mine: true, reviewing: false }),
    ).toEqual({
      ok: true,
      data: page,
    });
    expect(calledPath()).toBe(`/api/v1/workspaces/${WORKSPACE.id}/reviews?status=closed&author=me`);
  });

  it('getReview and getReviewFiles parse their responses', async () => {
    respond(200, REVIEW);
    expect(await getReview(WORKSPACE.id, '7')).toEqual({ ok: true, data: REVIEW });
    expect(calledPath()).toBe(`/api/v1/workspaces/${WORKSPACE.id}/reviews/7`);

    fetchSpy.mockReset();
    respond(200, [FILE]);
    expect(await getReviewFiles(WORKSPACE.id, '7')).toEqual({ ok: true, data: [FILE] });
    expect(calledPath()).toBe(`/api/v1/workspaces/${WORKSPACE.id}/reviews/7/files`);
  });

  it('passes a 404 through', async () => {
    respond(404, { error: { code: 'review_not_found', message: 'Review not found.' } });
    expect(await getReview(WORKSPACE.id, '7')).toEqual({ ok: false, status: 404 });
  });

  it('passes a 422 through', async () => {
    respond(422, { error: { code: 'validation_error', message: 'Invalid.' } });
    expect(await getReviews(WORKSPACE.id, { status: null, mine: false, reviewing: false })).toEqual(
      {
        ok: false,
        status: 422,
      },
    );
  });

  it('returns status 0 for a review with the wrong shape', async () => {
    respond(200, { ...REVIEW, number: 0 });
    expect(await getReview(WORKSPACE.id, '7')).toEqual({ ok: false, status: 0 });
  });

  it.each(['0', '01', '-1', '1.5', 'abc', '..', '7/files', '2147483648'])(
    'returns 404 without calling the API for the review number %j',
    async (reviewNumber) => {
      expect(await getReview(WORKSPACE.id, reviewNumber)).toEqual({ ok: false, status: 404 });
      expect(await getReviewFiles(WORKSPACE.id, reviewNumber)).toEqual({ ok: false, status: 404 });
      expect(fetchSpy).not.toHaveBeenCalled();
    },
  );

  it.each(['..', 'abc'])(
    'returns 404 without calling the API for the workspace id %j',
    async (workspaceId) => {
      expect(
        await getReviews(workspaceId, { status: null, mine: false, reviewing: false }),
      ).toEqual({
        ok: false,
        status: 404,
      });
      expect(await getReview(workspaceId, '7')).toEqual({ ok: false, status: 404 });
      expect(await getReviewFiles(workspaceId, '7')).toEqual({ ok: false, status: 404 });
      expect(fetchSpy).not.toHaveBeenCalled();
    },
  );
});

describe('approval reads', () => {
  let fetchSpy: MockInstance<typeof fetch>;
  const STATE = {
    state: 'pending',
    approvals: 0,
    requiredApprovals: 1,
    openThreads: 0,
    canMerge: false,
    reasons: ['0 of 1 required approval'],
  };

  beforeAll(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });
  beforeEach(() => {
    cookieStore.get.mockReturnValue({ value: TOKEN });
    fetchSpy.mockReset();
  });
  afterAll(() => {
    fetchSpy.mockRestore();
  });

  it('fetches the state under the review and validates it', async () => {
    fetchSpy.mockResolvedValue(new Response(JSON.stringify(STATE), { status: 200 }));
    expect(await getReviewState(WORKSPACE.id, '7')).toEqual({ ok: true, data: STATE });
    expect(String(fetchSpy.mock.calls[0]?.[0])).toMatch(
      new RegExp(`/api/v1/workspaces/${WORKSPACE.id}/reviews/7/state$`),
    );

    fetchSpy.mockResolvedValue(new Response(JSON.stringify({ ...STATE, approvals: -1 })));
    expect(await getReviewState(WORKSPACE.id, '7')).toEqual({ ok: false, status: 0 });
  });

  it.each([
    ['..', '7'],
    [WORKSPACE.id, '01'],
    [WORKSPACE.id, '../7'],
  ])('returns 404 without calling the API for %j / %j', async (workspaceId, reviewNumber) => {
    for (const get of [getReviewState, getReviewers, getDecisions, getReviewEvents]) {
      expect(await get(workspaceId, reviewNumber)).toEqual({ ok: false, status: 404 });
    }
    expect(await getRules('..')).toEqual({ ok: false, status: 404 });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('sendApi error details', () => {
  it('keeps the details of a failure for the caller to map', async () => {
    const details = { reasons: ['0 of 1 required approval'] };
    const fetchImpl = makeFetch(409, {
      error: { code: 'merge_blocked', message: 'blocked', details },
    });
    expect(
      await sendApi(API_URL, 'POST', '/x', TOKEN, undefined, WorkspaceSchema, fetchImpl),
    ).toEqual({ ok: false, status: 409, code: 'merge_blocked', fieldErrors: {}, details });
  });

  it('accepts an empty 204 for a schema that expects nothing', async () => {
    const { z } = await import('zod');
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));
    expect(
      await sendApi(API_URL, 'DELETE', '/x', TOKEN, undefined, z.undefined(), fetchImpl),
    ).toEqual({ ok: true, data: undefined });
  });
});
