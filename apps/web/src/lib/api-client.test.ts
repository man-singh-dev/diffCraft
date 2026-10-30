import { describe, expect, it, vi } from 'vitest';
import {
  addMember,
  changeMemberRole,
  createWorkspace,
  deleteWorkspace,
  leaveWorkspace,
  login,
  logout,
  register,
  removeMember,
  renameWorkspace,
} from './api-client.js';

const USER = {
  id: '01a17e5e-aa56-7985-be46-bf5f1c7e7fde',
  email: 'ada@example.com',
  displayName: 'Ada',
  createdAt: '2026-10-27T17:18:15.633Z',
};
const REGISTER_INPUT = { email: USER.email, displayName: 'Ada', password: 'correct horse battery' };
const LOGIN_INPUT = { email: USER.email, password: 'correct horse battery' };

function makeFetch(status: number, body?: unknown) {
  return vi.fn<typeof fetch>().mockResolvedValue(
    new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  );
}

const errorBody = (code: string, message: string, details?: unknown) => ({
  error: { code, message, details },
});

describe('register', () => {
  it('POSTs JSON to the relative register URL and returns the user', async () => {
    const fetchImpl = makeFetch(201, USER);
    const result = await register(REGISTER_INPUT, fetchImpl);

    expect(result).toEqual({ ok: true, data: USER });
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('/api/v1/auth/register');
    expect(init?.method).toBe('POST');
    expect(new Headers(init?.headers).get('content-type')).toBe('application/json');
    expect(JSON.parse(init?.body as string)).toEqual(REGISTER_INPUT);
  });

  it('turns a 422 into fieldErrors keyed by field (first message wins)', async () => {
    const details = [
      { field: 'email', message: 'Invalid email address' },
      { field: 'password', message: 'Too short' },
      { field: 'password', message: 'Second password issue' },
    ];
    const result = await register(
      REGISTER_INPUT,
      makeFetch(422, errorBody('validation_error', 'The request body is invalid.', details)),
    );

    expect(result).toEqual({
      ok: false,
      status: 422,
      code: 'validation_error',
      message: 'The request body is invalid.',
      fieldErrors: { email: 'Invalid email address', password: 'Too short' },
    });
  });

  it('returns 409 email_taken as a failure with no field errors', async () => {
    const result = await register(
      REGISTER_INPUT,
      makeFetch(409, errorBody('email_taken', 'Email already registered.')),
    );

    expect(result).toMatchObject({ ok: false, status: 409, code: 'email_taken', fieldErrors: {} });
  });

  it('treats a 2xx with an unexpected body as a failure', async () => {
    const result = await register(REGISTER_INPUT, makeFetch(201, { nope: true }));
    expect(result).toMatchObject({ ok: false, status: 201, code: 'unexpected_response' });
  });
});

describe('login', () => {
  it('returns the user on success', async () => {
    const fetchImpl = makeFetch(200, USER);
    expect(await login(LOGIN_INPUT, fetchImpl)).toEqual({ ok: true, data: USER });
    expect(fetchImpl.mock.calls[0]![0]).toBe('/api/v1/auth/login');
  });

  it('returns 401 with the API code and message', async () => {
    const result = await login(
      LOGIN_INPUT,
      makeFetch(401, errorBody('invalid_credentials', 'Invalid email or password.')),
    );

    expect(result).toEqual({
      ok: false,
      status: 401,
      code: 'invalid_credentials',
      message: 'Invalid email or password.',
      fieldErrors: {},
    });
  });

  it('turns a network error into a friendly message instead of throwing', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('Failed to fetch'));
    const result = await login(LOGIN_INPUT, fetchImpl);

    expect(result).toMatchObject({ ok: false, status: 0, code: 'network_error' });
    if (!result.ok) expect(result.message).toMatch(/couldn't reach the server/i);
  });

  it('handles an error response that is not JSON (e.g. the proxy failing)', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('<html>Internal Server Error</html>', { status: 500 }));

    expect(await login(LOGIN_INPUT, fetchImpl)).toMatchObject({
      ok: false,
      status: 500,
      code: 'unexpected_response',
      fieldErrors: {},
    });
  });
});

describe('logout', () => {
  it('POSTs without a body and succeeds on 204', async () => {
    const fetchImpl = makeFetch(204);
    expect(await logout(fetchImpl)).toEqual({ ok: true, data: undefined });

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('/api/v1/auth/logout');
    expect(init).toEqual({ method: 'POST' });
  });

  it('turns a network error into a failure', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('Failed to fetch'));
    expect(await logout(fetchImpl)).toMatchObject({ ok: false, code: 'network_error' });
  });
});

const WORKSPACE = {
  id: '01a17e5e-aa56-7985-be46-bf5f1c7e7fd0',
  name: 'Team',
  slug: 'team',
  createdAt: '2026-10-27T17:18:15.633Z',
  role: 'owner',
};
const MEMBER = {
  userId: USER.id,
  email: USER.email,
  displayName: 'Ada',
  role: 'admin',
  joinedAt: '2026-10-27T17:18:15.633Z',
};
const WS = `/api/v1/workspaces/${WORKSPACE.id}`;

describe('workspace and member calls', () => {
  it.each([
    {
      name: 'createWorkspace',
      call: (f: typeof fetch) => createWorkspace({ name: 'Team' }, f),
      method: 'POST',
      url: '/api/v1/workspaces',
      body: { name: 'Team' },
      response: [201, WORKSPACE],
    },
    {
      name: 'renameWorkspace',
      call: (f: typeof fetch) => renameWorkspace(WORKSPACE.id, { name: 'New' }, f),
      method: 'PATCH',
      url: WS,
      body: { name: 'New' },
      response: [200, WORKSPACE],
    },
    {
      name: 'deleteWorkspace',
      call: (f: typeof fetch) => deleteWorkspace(WORKSPACE.id, f),
      method: 'DELETE',
      url: WS,
      body: undefined,
      response: [204],
    },
    {
      name: 'addMember',
      call: (f: typeof fetch) => addMember(WORKSPACE.id, { email: USER.email, role: 'admin' }, f),
      method: 'POST',
      url: `${WS}/members`,
      body: { email: USER.email, role: 'admin' },
      response: [201, MEMBER],
    },
    {
      name: 'changeMemberRole',
      call: (f: typeof fetch) => changeMemberRole(WORKSPACE.id, USER.id, { role: 'admin' }, f),
      method: 'PATCH',
      url: `${WS}/members/${USER.id}`,
      body: { role: 'admin' },
      response: [200, MEMBER],
    },
    {
      name: 'removeMember',
      call: (f: typeof fetch) => removeMember(WORKSPACE.id, USER.id, f),
      method: 'DELETE',
      url: `${WS}/members/${USER.id}`,
      body: undefined,
      response: [204],
    },
    {
      name: 'leaveWorkspace',
      call: (f: typeof fetch) => leaveWorkspace(WORKSPACE.id, f),
      method: 'POST',
      url: `${WS}/members/leave`,
      body: undefined,
      response: [204],
    },
  ] as const)('$name sends $method $url', async ({ call, method, url, body, response }) => {
    const [status, responseBody] = response;
    const fetchImpl = makeFetch(status, responseBody);

    expect(await call(fetchImpl)).toEqual({ ok: true, data: responseBody });
    const [calledUrl, init] = fetchImpl.mock.calls[0]!;
    expect(calledUrl).toBe(url);
    expect(init?.method).toBe(method);
    if (body === undefined) expect(init?.body).toBeUndefined();
    else expect(JSON.parse(init?.body as string)).toEqual(body);
  });

  it('encodes ids so they cannot change the path', async () => {
    const fetchImpl = makeFetch(204);
    await removeMember('a/b', '../x', fetchImpl);
    expect(fetchImpl.mock.calls[0]![0]).toBe('/api/v1/workspaces/a%2Fb/members/..%2Fx');
  });

  it.each([
    [409, 'last_owner'],
    [409, 'already_member'],
    [404, 'user_not_found'],
    [403, 'forbidden'],
  ])('returns %i %s as a failure with the API code', async (status, code) => {
    const result = await changeMemberRole(
      WORKSPACE.id,
      USER.id,
      { role: 'viewer' },
      makeFetch(status, errorBody(code, 'API message')),
    );
    expect(result).toEqual({ ok: false, status, code, message: 'API message', fieldErrors: {} });
  });

  it('turns a 422 on addMember into field errors', async () => {
    const details = [{ field: 'email', message: 'Invalid email address' }];
    const result = await addMember(
      WORKSPACE.id,
      { email: 'x@example.com', role: 'member' },
      makeFetch(422, errorBody('validation_error', 'The request body is invalid.', details)),
    );
    expect(result).toMatchObject({
      ok: false,
      status: 422,
      fieldErrors: { email: details[0]!.message },
    });
  });

  it('turns a network error on a DELETE into a failure', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('Failed to fetch'));
    expect(await deleteWorkspace(WORKSPACE.id, fetchImpl)).toMatchObject({
      ok: false,
      status: 0,
      code: 'network_error',
    });
  });

  it('treats a member response with the wrong shape as a failure', async () => {
    const result = await addMember(
      WORKSPACE.id,
      { email: USER.email, role: 'member' },
      makeFetch(201, { ...MEMBER, role: 'superadmin' }),
    );
    expect(result).toMatchObject({ ok: false, code: 'unexpected_response' });
  });
});
