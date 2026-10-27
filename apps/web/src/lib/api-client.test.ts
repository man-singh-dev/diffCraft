import { describe, expect, it, vi } from 'vitest';
import { login, logout, register } from './api-client.js';

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
