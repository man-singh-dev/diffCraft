import type { AddressInfo } from 'node:net';
import {
  REALTIME_PATH,
  RealtimeTicketResponseSchema,
  ReviewSchema,
  WorkspaceSchema,
  type ReviewJoinAck,
  type ReviewJoinRequest,
  type ReviewLeaveAck,
} from '@diffcraft/shared';
import type { FastifyInstance } from 'fastify';
import { io as connectClient, type Socket as ClientSocket } from 'socket.io-client';
import { afterAll, afterEach, expect } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import type { RealtimeLimits } from '../modules/realtime/socket-server.js';
import { testDatabaseUrl } from './db.js';
import { FakeMailer } from './fake-mailer.js';
import { testRedisUrl } from './redis.js';
import type { TestUser } from './fixtures.js';

export const WEB_ORIGIN = 'http://localhost:3000';
export const TICKET_URL = '/api/v1/realtime/ticket';
export const PATCH = `--- a/a.txt
+++ b/a.txt
@@ -1 +1 @@
-old
+new
`;

const openSockets = new Set<ClientSocket>();
const openApps = new Set<FastifyInstance>();

export function closeRealtimeResourcesAfterTests() {
  afterEach(() => {
    for (const socket of openSockets) socket.disconnect();
    openSockets.clear();
  });
  afterAll(async () => {
    await Promise.all([...openApps].map((app) => app.close()));
  });
}

export async function startApp(realtimeLimits?: Partial<RealtimeLimits>) {
  const app = await buildApp(
    loadConfig({
      LOG_LEVEL: 'silent',
      RATE_LIMIT_ENABLED: 'false',
      DATABASE_URL: testDatabaseUrl,
      REDIS_URL: testRedisUrl ?? undefined,
      WEB_ORIGIN,
    }),
    {
      mailer: new FakeMailer(),
      // Test files share one database: a running relay would publish other files' outbox rows.
      relay: { enabled: false },
      ai: { worker: false },
      ...(realtimeLimits && { realtimeLimits }),
    },
  );
  openApps.add(app);
  await app.listen({ host: '127.0.0.1', port: 0 });
  const { port } = app.server.address() as AddressInfo;
  return { app, url: `http://127.0.0.1:${port}` };
}

export function forgetApp(app: FastifyInstance) {
  openApps.delete(app);
}

export async function getTicket(app: FastifyInstance, user: TestUser): Promise<string> {
  const res = await app.inject({ method: 'POST', url: TICKET_URL, cookies: user.cookies });
  expect(res.statusCode).toBe(200);
  return RealtimeTicketResponseSchema.parse(res.json()).ticket;
}

export function connect(
  url: string,
  auth: Record<string, unknown>,
  origin: string = WEB_ORIGIN,
): Promise<ClientSocket> {
  const socket = connectClient(url, {
    path: REALTIME_PATH,
    transports: ['websocket'],
    auth,
    extraHeaders: { origin },
    reconnection: false,
    forceNew: true,
  });
  openSockets.add(socket);
  return new Promise((resolve, reject) => {
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', (err) => {
      socket.disconnect();
      reject(err);
    });
  });
}

export async function connectAs(app: FastifyInstance, url: string, user: TestUser) {
  return connect(url, { ticket: await getTicket(app, user) });
}

export const join = (socket: ClientSocket, request: unknown): Promise<ReviewJoinAck> =>
  socket.timeout(5_000).emitWithAck('review:join', request as ReviewJoinRequest);

export const leave = (socket: ClientSocket, reviewId: string): Promise<ReviewLeaveAck> =>
  socket.timeout(5_000).emitWithAck('review:leave', { reviewId });

export async function createWorkspace(app: FastifyInstance, owner: TestUser) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/workspaces',
    cookies: owner.cookies,
    payload: { name: 'Realtime' },
  });
  return WorkspaceSchema.parse(res.json());
}

export async function createReview(app: FastifyInstance, owner: TestUser, workspaceId: string) {
  const res = await app.inject({
    method: 'POST',
    url: `/api/v1/workspaces/${workspaceId}/reviews`,
    cookies: owner.cookies,
    payload: { title: 'Change', patch: PATCH },
  });
  return ReviewSchema.parse(res.json());
}

export function nextEvent(
  socket: ClientSocket,
  event: string,
  timeoutMs = 3_000,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`no ${event} within ${timeoutMs} ms`)),
      timeoutMs,
    );
    socket.once(event, (payload: unknown) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

export async function receivedWithin(socket: ClientSocket, event: string, ms: number) {
  let received = false;
  const listener = () => (received = true);
  socket.on(event, listener);
  await new Promise((resolve) => setTimeout(resolve, ms));
  socket.off(event, listener);
  return received;
}

export interface ReceivedEvent {
  event: string;
  payload: unknown;
}

export function recordEvents(socket: ClientSocket) {
  const events: ReceivedEvent[] = [];
  const listener = (event: string, payload: unknown) => events.push({ event, payload });
  socket.onAny(listener);
  return {
    events,
    stop: () => socket.offAny(listener),
  };
}
