import { describe, expect, it, vi } from 'vitest';
import { fetchRealtimeTicket } from './ticket';

describe('fetchRealtimeTicket', () => {
  const respond = (status: number, body?: unknown) =>
    vi.fn(async () => new Response(body === undefined ? null : JSON.stringify(body), { status }));

  it('POSTs, uncached, and returns the ticket', async () => {
    const fetchImpl = respond(200, { ticket: 'abc', expiresInSeconds: 30 });
    expect(await fetchRealtimeTicket(fetchImpl)).toEqual({ ok: true, ticket: 'abc' });
    expect(fetchImpl).toHaveBeenCalledWith('/api/v1/realtime/ticket', {
      method: 'POST',
      cache: 'no-store',
    });
  });

  it('reports 401 as unauthorized, and anything else as a retryable failure', async () => {
    expect(await fetchRealtimeTicket(respond(401))).toEqual({ ok: false, unauthorized: true });
    expect(await fetchRealtimeTicket(respond(500))).toEqual({ ok: false, unauthorized: false });
    expect(await fetchRealtimeTicket(respond(200, { nope: 1 }))).toEqual({
      ok: false,
      unauthorized: false,
    });
    const offline = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    expect(await fetchRealtimeTicket(offline)).toEqual({ ok: false, unauthorized: false });
  });
});
