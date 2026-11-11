import { REALTIME_PATH } from '@diffcraft/shared';
import { io } from 'socket.io-client';
import { realtimeConfig, warnIfRealtimeDisabled } from './config';
import { fetchRealtimeTicket, type TicketResult } from './ticket';

export type ConnectionStatus = 'connecting' | 'live' | 'reconnecting' | 'offline';

type Listener = (...args: never[]) => void;

export interface RealtimeSocket {
  readonly connected: boolean;
  readonly active: boolean;
  on(event: string, listener: Listener): unknown;
  off(event: string, listener: Listener): unknown;
  emit(event: string, ...args: unknown[]): unknown;
  connect(): unknown;
  disconnect(): unknown;
}

export type SocketAuth = (callback: (data: Record<string, unknown>) => void) => void;

export interface RealtimeConnection {
  socket: RealtimeSocket;
  status(): ConnectionStatus;
  subscribe(listener: () => void): () => void;
  close(): void;
}

// Same as Socket.IO's reconnection defaults (reconnectionDelay, reconnectionDelayMax, randomizationFactor).
const RETRY_MIN_MS = 1_000;
const RETRY_MAX_MS = 5_000;
const JITTER = 0.5;

export interface ConnectionDeps {
  createSocket: (auth: SocketAuth) => RealtimeSocket;
  fetchTicket: () => Promise<TicketResult>;
  random?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
}

export function createRealtimeConnection({
  createSocket,
  fetchTicket,
  random = Math.random,
  setTimer = setTimeout,
}: ConnectionDeps): RealtimeConnection {
  let status: ConnectionStatus = 'connecting';
  let stopped = false;
  let everConnected = false;
  let attempts = 0;
  const listeners = new Set<() => void>();

  const setStatus = (next: ConnectionStatus) => {
    if (next === status) return;
    status = next;
    for (const listener of listeners) listener();
  };
  const waiting = () => setStatus(everConnected ? 'reconnecting' : 'connecting');

  // Called before every connection attempt: tickets are single-use, so each attempt needs a fresh one.
  const auth: SocketAuth = (callback) => {
    void fetchTicket().then((result) => {
      if (result.ok) {
        callback({ ticket: result.ticket });
        return;
      }
      if (result.unauthorized) stopped = true;
      // No ticket: the server refuses the handshake and connect_error decides whether to retry.
      callback({});
    });
  };

  const socket = createSocket(auth);

  // A handshake refused by the server leaves the socket inactive: Socket.IO won't retry it, so this does.
  function retryLater() {
    if (stopped) {
      setStatus('offline');
      return;
    }
    waiting();
    const base = Math.min(RETRY_MIN_MS * 2 ** attempts, RETRY_MAX_MS);
    attempts += 1;
    const delay = base * (1 - JITTER + 2 * JITTER * random());
    setTimer(() => {
      if (!stopped && !socket.active) socket.connect();
    }, delay);
  }

  socket.on('connect', () => {
    attempts = 0;
    everConnected = true;
    setStatus('live');
  });
  socket.on('disconnect', () => {
    if (socket.active) waiting();
    else retryLater();
  });
  socket.on('connect_error', () => {
    if (stopped) {
      socket.disconnect();
      setStatus('offline');
    } else if (socket.active) {
      waiting();
    } else {
      retryLater();
    }
  });

  return {
    socket,
    status: () => status,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    close() {
      stopped = true;
      socket.disconnect();
      setStatus('offline');
    },
  };
}

let connection: RealtimeConnection | null | undefined;

export function getRealtimeConnection(): RealtimeConnection | null {
  if (typeof window === 'undefined') return null;
  if (connection !== undefined) return connection;
  warnIfRealtimeDisabled();
  const config = realtimeConfig;
  connection = config.ok
    ? createRealtimeConnection({
        // RealtimeSocket is a subset of Socket's API; only Socket's generic signatures need the cast.
        createSocket: (auth) =>
          io(config.url, {
            path: REALTIME_PATH,
            transports: ['websocket'],
            auth,
          }) as unknown as RealtimeSocket,
        fetchTicket: () => fetchRealtimeTicket(),
      })
    : null;
  return connection;
}

// The socket is authenticated as whoever was logged in: it must not outlive the session in this tab.
export function closeRealtimeConnection(): void {
  connection?.close();
  connection = undefined;
}
