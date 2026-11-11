import { describe, expect, it, vi } from 'vitest';
import { createRealtimeConnection, type SocketAuth } from './connection';
import { FakeSocket } from './fake-socket';
import type { TicketResult } from './ticket';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function setup(tickets: TicketResult[]) {
  const socket = new FakeSocket();
  let auth: SocketAuth | undefined;
  const timers: { fn: () => void; ms: number }[] = [];
  const fetchTicket = vi.fn(
    async (): Promise<TicketResult> => tickets.shift() ?? { ok: false, unauthorized: false },
  );
  const connection = createRealtimeConnection({
    createSocket: (a) => {
      auth = a;
      return socket;
    },
    fetchTicket,
    random: () => 0.5,
    setTimer: (fn, ms) => timers.push({ fn, ms }),
  });
  const authenticate = async () => {
    const data = new Promise<Record<string, unknown>>((resolve) => auth!(resolve));
    await flush();
    return data;
  };
  return { socket, connection, fetchTicket, timers, authenticate };
}

describe('createRealtimeConnection', () => {
  it('fetches a fresh ticket for every connection attempt', async () => {
    const { authenticate, fetchTicket } = setup([
      { ok: true, ticket: 'first' },
      { ok: true, ticket: 'second' },
    ]);
    expect(await authenticate()).toEqual({ ticket: 'first' });
    expect(await authenticate()).toEqual({ ticket: 'second' });
    expect(fetchTicket).toHaveBeenCalledTimes(2);
  });

  it('stops reconnecting when the ticket request returns 401', async () => {
    const { socket, connection, timers, authenticate } = setup([{ ok: false, unauthorized: true }]);
    expect(await authenticate()).toEqual({});
    socket.refuse();
    expect(socket.disconnectCalls).toBe(1);
    expect(timers).toEqual([]);
    expect(connection.status()).toBe('offline');

    socket.receive('disconnect', 'io client disconnect');
    expect(timers).toEqual([]);
    expect(connection.status()).toBe('offline');
  });

  it('retries with a fresh ticket after a network error, with growing capped delays', async () => {
    const { socket, connection, timers, authenticate } = setup([]);
    for (let i = 0; i < 4; i += 1) {
      expect(await authenticate()).toEqual({});
      socket.refuse();
      timers.at(-1)!.fn();
    }
    expect(timers.map((t) => t.ms)).toEqual([1_000, 2_000, 4_000, 5_000]);
    expect(socket.connectCalls).toBe(4);
    expect(connection.status()).toBe('connecting');

    socket.serverConnect();
    socket.transportDrop();
    socket.refuse();
    expect(timers.at(-1)!.ms).toBe(1_000);
  });

  it('leaves transport failures to Socket.IO and reports the status', () => {
    const { socket, connection, timers } = setup([]);
    const seen: string[] = [];
    connection.subscribe(() => seen.push(connection.status()));

    socket.receive('connect_error', new Error('websocket error'));
    expect(connection.status()).toBe('connecting');
    socket.serverConnect();
    socket.transportDrop();
    socket.receive('connect_error', new Error('websocket error'));
    socket.serverConnect();

    expect(timers).toEqual([]);
    expect(seen).toEqual(['live', 'reconnecting', 'live']);
  });

  it('reconnects itself after the server disconnects the socket', () => {
    const { socket, connection, timers } = setup([]);
    socket.serverConnect();
    socket.connected = false;
    socket.active = false;
    socket.receive('disconnect', 'io server disconnect');
    expect(connection.status()).toBe('reconnecting');
    timers[0]!.fn();
    expect(socket.connectCalls).toBe(1);
  });

  it('closes for good: disconnects, reports offline and never reconnects', () => {
    const { socket, connection, timers } = setup([]);
    socket.serverConnect();
    connection.close();
    socket.receive('disconnect', 'io client disconnect');
    expect(socket.disconnectCalls).toBe(1);
    expect(connection.status()).toBe('offline');
    expect(timers).toEqual([]);
  });
});
