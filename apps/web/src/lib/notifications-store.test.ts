import type { Notification, NotificationListResponse } from '@diffcraft/shared';
import { describe, expect, it, vi } from 'vitest';
import type { ApiResult } from './api-client';
import { createNotificationsStore, type NotificationsApi } from './notifications-store';
import { notification } from './notification-fixture';
import { createRealtimeConnection } from './realtime/connection';
import { FakeSocket } from './realtime/fake-socket';

const id = (n: number) => `01a17e5e-aa56-7985-be46-${String(n).padStart(12, '0')}`;
const item = (n: number, overrides: Partial<Notification> = {}) =>
  notification({ id: id(n), ...overrides });

const ok = <T>(data: T): ApiResult<T> => ({ ok: true, data });
const failed: ApiResult<never> = {
  ok: false,
  status: 500,
  code: 'internal_error',
  message: 'Something went wrong.',
  fieldErrors: {},
};
const page = (items: Notification[], nextCursor: string | null = null) =>
  ok<NotificationListResponse>({ items, nextCursor });

function setup(initialUnread = 2, overrides: Partial<NotificationsApi> = {}) {
  const api = {
    list: vi.fn<NotificationsApi['list']>(
      overrides.list ??
        (async () => page([item(2), item(1, { readAt: '2026-11-12T09:00:00.000Z' })])),
    ),
    unreadCount: vi.fn<NotificationsApi['unreadCount']>(
      overrides.unreadCount ?? (async () => ok({ count: initialUnread })),
    ),
    markRead: vi.fn<NotificationsApi['markRead']>(
      overrides.markRead ?? (async () => ok(undefined)),
    ),
    markAllRead: vi.fn<NotificationsApi['markAllRead']>(
      overrides.markAllRead ?? (async () => ok(undefined)),
    ),
  };
  const store = createNotificationsStore(initialUnread, api, () => '2026-11-12T11:00:00.000Z');
  const socket = new FakeSocket();
  const connection = createRealtimeConnection({
    createSocket: () => socket,
    fetchTicket: async () => ({ ok: true, ticket: 't' }),
    setTimer: () => undefined,
  });
  const detach = store.attach(connection);
  const state = () => store.getState();
  return { api, store, socket, detach, state };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('notifications store', () => {
  it('starts from the server-rendered count and loads the first page on demand', async () => {
    const { store, api, state } = setup(2);
    expect(state()).toMatchObject({ unread: 2, items: [], loaded: false });
    await store.loadFirstPage();
    expect(api.list).toHaveBeenCalledWith(null);
    expect(state().items.map((n) => n.id)).toEqual([id(2), id(1)]);
    expect(state().loaded).toBe(true);
  });

  it('prepends a pushed notification and counts it, once even if delivered twice', async () => {
    const { store, socket, state } = setup(2);
    await store.loadFirstPage();

    socket.receive('notification:new', item(3));
    socket.receive('notification:new', item(3));
    expect(state().items.map((n) => n.id)).toEqual([id(3), id(2), id(1)]);
    expect(state().unread).toBe(3);

    socket.receive('notification:new', item(2));
    expect(state().unread).toBe(3);
  });

  it('ignores a push that fails validation', () => {
    const { socket, state } = setup(0);
    socket.receive('notification:new', { ...item(3), type: 'mentioned' });
    socket.receive('notification:new', 'nope');
    expect(state()).toMatchObject({ unread: 0, items: [] });
  });

  it('refetches the count and the first page after a reconnect', async () => {
    const { store, socket, api, state } = setup(2);
    await store.loadFirstPage();
    socket.serverConnect();
    await flush();
    api.list.mockResolvedValueOnce(page([item(5), item(4), item(2)]));
    api.unreadCount.mockResolvedValueOnce(ok({ count: 4 }));

    socket.transportDrop();
    socket.serverConnect();
    await flush();
    expect(api.unreadCount).toHaveBeenCalledTimes(2);
    expect(api.list).toHaveBeenCalledTimes(3);
    expect(state().unread).toBe(4);
    expect(state().items.map((n) => n.id)).toEqual([id(5), id(4), id(2)]);

    socket.receive('notification:new', item(5));
    expect(state().unread).toBe(4);
  });

  it('refetches only the count on connect while the list was never opened', async () => {
    const { socket, api } = setup(2);
    socket.serverConnect();
    await flush();
    expect(api.unreadCount).toHaveBeenCalledTimes(1);
    expect(api.list).not.toHaveBeenCalled();
  });

  it('keeps a push that overtook the first page', async () => {
    let respond!: (result: ApiResult<NotificationListResponse>) => void;
    const { store, socket, state } = setup(0, {
      list: () => new Promise((resolve) => (respond = resolve)),
    });
    const loading = store.loadFirstPage();
    socket.receive('notification:new', item(9));
    respond(page([item(2)]));
    await loading;
    expect(state().items.map((n) => n.id)).toEqual([id(9), id(2)]);
  });

  it('marking one read lowers the badge, and only once', async () => {
    const { store, api, state } = setup(2);
    await store.loadFirstPage();

    await store.markRead(id(2));
    expect(api.markRead).toHaveBeenCalledWith(id(2));
    expect(state().unread).toBe(1);
    expect(state().items[0]!.readAt).toBe('2026-11-12T11:00:00.000Z');

    await store.markRead(id(2));
    await store.markRead(id(1));
    expect(state().unread).toBe(1);
  });

  it('puts the badge back when marking read fails', async () => {
    const { store, state } = setup(2, { markRead: async () => failed });
    await store.loadFirstPage();
    await store.markRead(id(2));
    expect(state().unread).toBe(2);
    expect(state().items[0]!.readAt).toBeNull();
  });

  it('marks everything read, or restores the list if that fails', async () => {
    const { store, state } = setup(2);
    await store.loadFirstPage();
    await store.markAllRead();
    expect(state().unread).toBe(0);
    expect(state().items.every((n) => n.readAt !== null)).toBe(true);

    const failing = setup(2, { markAllRead: async () => failed });
    await failing.store.loadFirstPage();
    await failing.store.markAllRead();
    expect(failing.state().unread).toBe(2);
    expect(failing.state().items[0]!.readAt).toBeNull();
    expect(failing.state().error).toBe('Something went wrong.');
  });

  it('loads more with the cursor and skips anything already shown', async () => {
    const { store, api, state } = setup(2, {
      list: vi.fn(async (cursor: string | null) =>
        cursor === null ? page([item(3), item(2)], 'next') : page([item(2), item(1)]),
      ),
    });
    await store.loadFirstPage();
    await store.loadMore();
    expect(api.list).toHaveBeenLastCalledWith('next');
    expect(state().items.map((n) => n.id)).toEqual([id(3), id(2), id(1)]);
    expect(state().nextCursor).toBeNull();
  });

  it('stops listening once detached', () => {
    const { socket, detach, state } = setup(0);
    detach();
    socket.receive('notification:new', item(3));
    expect(state().unread).toBe(0);
    expect(socket.listenerCount('notification:new')).toBe(0);
  });
});
