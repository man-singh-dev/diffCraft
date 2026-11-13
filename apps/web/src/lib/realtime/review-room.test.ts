import type { Thread } from '@diffcraft/shared';
import { describe, expect, it, vi } from 'vitest';
import { createRealtimeConnection } from './connection';
import { FakeSocket } from './fake-socket';
import { subscribeToReviewRoom, type ReviewRoomStatus } from './review-room';

const WS = '3f2b8c1e-5d4a-4e6b-9c7d-1a2b3c4d5e6f';
const REVIEW = '01a17e5e-aa56-7985-be46-bf5f1c7e7f10';
const OTHER_REVIEW = '01a17e5e-aa56-7985-be46-bf5f1c7e7f11';
const ACTOR = '01a17e5e-aa56-7985-be46-bf5f1c7e7f01';
const AT = '2026-11-11T10:00:00.000Z';

const thread: Thread = {
  id: '01a17e5e-aa56-7985-be46-bf5f1c7e7f20',
  reviewId: REVIEW,
  anchor: null,
  status: 'open',
  resolvedBy: null,
  resolvedAt: null,
  createdBy: { id: ACTOR, displayName: 'Ada' },
  createdAt: AT,
  comments: [],
};

function setup({ connected = true } = {}) {
  const socket = new FakeSocket();
  const connection = createRealtimeConnection({
    createSocket: () => socket,
    fetchTicket: async () => ({ ok: true, ticket: 't' }),
    setTimer: () => undefined,
  });
  if (connected) socket.serverConnect();
  const statuses: ReviewRoomStatus[] = [];
  const handlers = {
    onThread: vi.fn(),
    onReviewChanged: vi.fn(),
    onReviewDeleted: vi.fn(),
    onPresence: vi.fn(),
    onAnalysisStatus: vi.fn(),
    onAnalysisCompleted: vi.fn(),
    onAccessRevoked: vi.fn(),
    onResync: vi.fn(),
  };
  const unsubscribe = subscribeToReviewRoom(connection, {
    workspaceId: WS,
    reviewNumber: 7,
    onStatus: (status) => statuses.push(status),
    ...handlers,
  });
  const status = () => statuses.at(-1);
  return { socket, handlers, unsubscribe, status };
}

const joinAck = { ok: true, reviewId: REVIEW };

describe('subscribeToReviewRoom', () => {
  it('joins at once when connected, and is live after the acknowledgement', () => {
    const { socket, status, handlers } = setup();
    expect(socket.sentEvents('review:join').map((s) => s.args[0])).toEqual([
      { workspaceId: WS, reviewNumber: 7 },
    ]);
    expect(status()).toBe('connecting');
    socket.ack('review:join', 0, joinAck);
    expect(status()).toBe('live');
    expect(handlers.onResync).not.toHaveBeenCalled();
  });

  it('waits for the first connect, which is not a resync', () => {
    const { socket, status, handlers } = setup({ connected: false });
    expect(socket.sentEvents('review:join')).toEqual([]);
    expect(status()).toBe('connecting');
    socket.serverConnect();
    socket.ack('review:join', 0, joinAck);
    expect(status()).toBe('live');
    expect(handlers.onResync).not.toHaveBeenCalled();
  });

  it('re-joins after every reconnect and resyncs once back in the room', () => {
    const { socket, status, handlers } = setup();
    socket.ack('review:join', 0, joinAck);

    socket.transportDrop();
    expect(status()).toBe('reconnecting');
    socket.serverConnect();
    expect(socket.sentEvents('review:join')).toHaveLength(2);
    expect(status()).toBe('reconnecting');
    expect(handlers.onResync).not.toHaveBeenCalled();
    socket.ack('review:join', 1, joinAck);
    expect(status()).toBe('live');
    expect(handlers.onResync).toHaveBeenCalledTimes(1);

    socket.transportDrop();
    socket.serverConnect();
    socket.ack('review:join', 2, joinAck);
    expect(handlers.onResync).toHaveBeenCalledTimes(2);
  });

  it('ignores an acknowledgement from before a reconnect', () => {
    const { socket, status, handlers } = setup();
    socket.transportDrop();
    socket.serverConnect();
    socket.ack('review:join', 0, joinAck);
    expect(status()).toBe('connecting');
    socket.ack('review:join', 1, joinAck);
    expect(status()).toBe('live');
    expect(handlers.onResync).not.toHaveBeenCalled();
  });

  it('reports offline when the join is refused', () => {
    const { socket, status } = setup();
    socket.ack('review:join', 0, { ok: false, error: 'not_found' });
    expect(status()).toBe('offline');
  });

  it('passes on valid events for this review only', () => {
    const { socket, handlers } = setup();
    const base = { reviewId: REVIEW, actorId: ACTOR, at: AT };
    socket.receive('thread:upsert', { ...base, thread });
    expect(handlers.onThread).not.toHaveBeenCalled();

    socket.ack('review:join', 0, joinAck);
    socket.receive('thread:upsert', { ...base, thread });
    socket.receive('thread:upsert', { ...base, thread: { ...thread, status: 'gone' } });
    socket.receive('thread:upsert', { ...base, reviewId: OTHER_REVIEW, thread });
    socket.receive('review:changed', { ...base, reason: 'merged' });
    socket.receive('review:changed', { ...base, reason: 'rules' });
    socket.receive('review:changed', { ...base, reviewId: OTHER_REVIEW, reason: 'merged' });
    socket.receive('review:deleted', { ...base, at: 'yesterday' });
    socket.receive('review:deleted', base);

    expect(handlers.onThread.mock.calls).toEqual([[{ ...base, thread }]]);
    expect(handlers.onReviewChanged.mock.calls).toEqual([[{ ...base, reason: 'merged' }]]);
    expect(handlers.onReviewDeleted.mock.calls).toEqual([[base]]);
  });

  it('validates presence events and passes on those for this review', () => {
    const { socket, handlers } = setup();
    const presence = {
      reviewId: REVIEW,
      at: AT,
      viewers: [{ id: ACTOR, displayName: 'Ada' }],
      total: 1,
    };
    socket.receive('presence', presence);
    expect(handlers.onPresence).not.toHaveBeenCalled();

    socket.ack('review:join', 0, joinAck);
    socket.receive('presence', { ...presence, reviewId: OTHER_REVIEW });
    socket.receive('presence', { ...presence, total: -1 });
    socket.receive('presence', { ...presence, viewers: [{ id: 'nope', displayName: 'X' }] });
    socket.receive('presence', presence);
    expect(handlers.onPresence.mock.calls).toEqual([[presence]]);
  });

  it('validates analysis events and passes on those for this review', () => {
    const { socket, handlers } = setup();
    socket.ack('review:join', 0, joinAck);
    const job = {
      id: '01a17e5e-aa56-7985-be46-bf5f1c7e7f30',
      reviewId: REVIEW,
      status: 'running',
      requestedBy: ACTOR,
      model: 'm',
      promptVersion: 'review-v1',
      attempts: 1,
      errorCode: null,
      summary: null,
      inputTokens: null,
      outputTokens: null,
      droppedFindings: 0,
      createdAt: AT,
      startedAt: AT,
      finishedAt: null,
    };
    const status = { reviewId: REVIEW, actorId: null, at: AT, job };
    const completed = { reviewId: REVIEW, actorId: null, at: AT, jobId: job.id, findings: 2 };
    socket.receive('analysis:status', { ...status, job: { ...job, status: 'done' } });
    socket.receive('analysis:status', { ...status, reviewId: OTHER_REVIEW });
    socket.receive('analysis:status', status);
    socket.receive('analysis:completed', { ...completed, findings: -1 });
    socket.receive('analysis:completed', completed);
    expect(handlers.onAnalysisStatus.mock.calls).toEqual([[status]]);
    expect(handlers.onAnalysisCompleted.mock.calls).toEqual([[completed]]);
  });

  it('ignores events while disconnected, until the room is joined again', () => {
    const { socket, handlers } = setup();
    socket.ack('review:join', 0, joinAck);
    socket.transportDrop();
    socket.receive('review:changed', { reviewId: REVIEW, actorId: null, at: AT, reason: 'merged' });
    expect(handlers.onReviewChanged).not.toHaveBeenCalled();
  });

  it('stops for good when access is revoked: no further events, no re-join, status revoked', () => {
    const { socket, handlers, status, unsubscribe } = setup();
    socket.ack('review:join', 0, joinAck);
    socket.receive('review:access-revoked', { reviewId: OTHER_REVIEW, reason: 'removed' });
    socket.receive('review:access-revoked', { reviewId: REVIEW, reason: 'kicked' });
    expect(handlers.onAccessRevoked).not.toHaveBeenCalled();
    expect(status()).toBe('live');

    const revoked = { reviewId: REVIEW, reason: 'removed' };
    socket.receive('review:access-revoked', revoked);
    expect(handlers.onAccessRevoked.mock.calls).toEqual([[revoked]]);
    expect(status()).toBe('revoked');

    const base = { reviewId: REVIEW, actorId: ACTOR, at: AT };
    socket.receive('thread:upsert', { ...base, thread });
    socket.receive('review:changed', { ...base, reason: 'merged' });
    socket.receive('presence', { reviewId: REVIEW, at: AT, viewers: [], total: 0 });
    expect(handlers.onThread).not.toHaveBeenCalled();
    expect(handlers.onReviewChanged).not.toHaveBeenCalled();
    expect(handlers.onPresence).not.toHaveBeenCalled();

    socket.transportDrop();
    socket.serverConnect();
    expect(socket.sentEvents('review:join')).toHaveLength(1);
    expect(handlers.onResync).not.toHaveBeenCalled();
    expect(status()).toBe('revoked');

    unsubscribe();
    expect(socket.sentEvents('review:leave')).toEqual([]);
  });

  it('ignores a revocation that arrives before the join is acknowledged', () => {
    const { socket, handlers, status } = setup();
    socket.receive('review:access-revoked', { reviewId: REVIEW, reason: 'removed' });
    expect(handlers.onAccessRevoked).not.toHaveBeenCalled();
    socket.ack('review:join', 0, joinAck);
    expect(status()).toBe('live');
  });

  it('reports a session ended when the reconnect ticket is refused', async () => {
    const socket = new FakeSocket();
    const tickets = [
      { ok: true as const, ticket: 't' },
      { ok: false as const, unauthorized: true },
    ];
    let auth: ((callback: (data: Record<string, unknown>) => void) => void) | undefined;
    const timers: (() => void)[] = [];
    const connection = createRealtimeConnection({
      createSocket: (a) => {
        auth = a;
        return socket;
      },
      fetchTicket: async () => tickets.shift()!,
      setTimer: (fn) => timers.push(fn),
    });
    const statuses: ReviewRoomStatus[] = [];
    subscribeToReviewRoom(connection, {
      workspaceId: WS,
      reviewNumber: 7,
      onStatus: (s) => statuses.push(s),
    });
    auth!(() => undefined);
    socket.serverConnect();
    socket.ack('review:join', 0, joinAck);

    socket.connected = false;
    socket.active = false;
    socket.receive('disconnect', 'io server disconnect');
    timers.shift()!();
    await new Promise<void>((resolve) => auth!(() => resolve()));
    socket.refuse();

    expect(statuses.at(-1)).toBe('session_ended');
    expect(timers).toEqual([]);
  });

  it('leaves the room (with an acknowledgement callback) and stops listening on unsubscribe', () => {
    const { socket, unsubscribe, handlers, status } = setup();
    socket.ack('review:join', 0, joinAck);
    const before = status();
    unsubscribe();

    const [leave] = socket.sentEvents('review:leave');
    expect(leave!.args[0]).toEqual({ reviewId: REVIEW });
    expect(typeof leave!.args[1]).toBe('function');
    expect(socket.listenerCount('thread:upsert')).toBe(0);
    expect(socket.listenerCount('connect')).toBe(1);

    socket.transportDrop();
    socket.serverConnect();
    expect(socket.sentEvents('review:join')).toHaveLength(1);
    expect(handlers.onResync).not.toHaveBeenCalled();
    expect(status()).toBe(before);
  });
});
