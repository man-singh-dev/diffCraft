import {
  NotificationSchema,
  type Notification,
  type NotificationListResponse,
  type UnreadCountResponse,
} from '@diffcraft/shared';
import type { ApiResult } from './api-client';
import type { RealtimeConnection } from './realtime/connection';

export interface NotificationsState {
  unread: number;
  items: Notification[];
  nextCursor: string | null;
  loaded: boolean;
  loading: boolean;
  error: string | null;
}

export interface NotificationsApi {
  list(cursor: string | null): Promise<ApiResult<NotificationListResponse>>;
  unreadCount(): Promise<ApiResult<UnreadCountResponse>>;
  markRead(id: string): Promise<ApiResult<void>>;
  markAllRead(): Promise<ApiResult<void>>;
}

export interface NotificationsStore {
  getState(): NotificationsState;
  subscribe(listener: () => void): () => void;
  loadFirstPage(): Promise<void>;
  loadMore(): Promise<void>;
  refreshCount(): Promise<void>;
  receive(payload: unknown): void;
  markRead(id: string): Promise<void>;
  markAllRead(): Promise<void>;
  attach(connection: RealtimeConnection): () => void;
}

export function createNotificationsStore(
  initialUnread: number,
  api: NotificationsApi,
  now: () => string = () => new Date().toISOString(),
): NotificationsStore {
  let state: NotificationsState = {
    unread: initialUnread,
    items: [],
    nextCursor: null,
    loaded: false,
    loading: false,
    error: null,
  };
  const listeners = new Set<() => void>();
  // Every id ever shown or counted: delivery is at least once, so a repeat must change nothing.
  const known = new Set<string>();
  let pushedDuringLoad = new Set<string>();
  let pageRequest = 0;

  const set = (patch: Partial<NotificationsState>) => {
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  };

  async function loadFirstPage() {
    const current = ++pageRequest;
    pushedDuringLoad = new Set();
    set({ loading: true, error: null });
    const result = await api.list(null);
    if (current !== pageRequest) return;
    if (!result.ok) {
      set({ loading: false, error: result.message });
      return;
    }
    const fetched = result.data.items;
    for (const n of fetched) known.add(n.id);
    const fetchedIds = new Set(fetched.map((n) => n.id));
    // A push can overtake the page request; keep it rather than let it vanish from the list.
    const overtaken = state.items.filter(
      (n) => pushedDuringLoad.has(n.id) && !fetchedIds.has(n.id),
    );
    set({
      items: [...overtaken, ...fetched],
      nextCursor: result.data.nextCursor,
      loaded: true,
      loading: false,
    });
  }

  async function loadMore() {
    if (!state.nextCursor || state.loading) return;
    const current = pageRequest;
    set({ loading: true, error: null });
    const result = await api.list(state.nextCursor);
    if (current !== pageRequest) return;
    if (!result.ok) {
      set({ loading: false, error: result.message });
      return;
    }
    const shown = new Set(state.items.map((n) => n.id));
    const older = result.data.items.filter((n) => !shown.has(n.id));
    for (const n of older) known.add(n.id);
    set({
      items: [...state.items, ...older],
      nextCursor: result.data.nextCursor,
      loading: false,
    });
  }

  async function refreshCount() {
    const result = await api.unreadCount();
    if (result.ok) set({ unread: result.data.count });
  }

  function receive(payload: unknown) {
    const parsed = NotificationSchema.safeParse(payload);
    if (!parsed.success || known.has(parsed.data.id)) return;
    const notification = parsed.data;
    known.add(notification.id);
    pushedDuringLoad.add(notification.id);
    set({
      items: [notification, ...state.items],
      unread: state.unread + (notification.readAt === null ? 1 : 0),
    });
  }

  const withReadAt = (id: string, readAt: string | null) =>
    state.items.map((n) => (n.id === id ? { ...n, readAt } : n));

  async function markRead(id: string) {
    const item = state.items.find((n) => n.id === id);
    const wasUnread = item !== undefined && item.readAt === null;
    if (wasUnread) set({ items: withReadAt(id, now()), unread: Math.max(0, state.unread - 1) });
    const result = await api.markRead(id);
    if (result.ok) return;
    if (wasUnread) set({ items: withReadAt(id, null), unread: state.unread + 1 });
    else await refreshCount();
  }

  async function markAllRead() {
    const before = state;
    const readAt = now();
    set({ items: state.items.map((n) => (n.readAt ? n : { ...n, readAt })), unread: 0 });
    const result = await api.markAllRead();
    if (!result.ok) set({ items: before.items, unread: before.unread, error: result.message });
  }

  function attach({ socket }: RealtimeConnection) {
    const onNotification = (payload: unknown) => receive(payload);
    // Pushes sent while disconnected (or before the first connect) are gone: catch up over HTTP.
    const onConnect = () => {
      void refreshCount();
      if (state.loaded) void loadFirstPage();
    };
    socket.on('notification:new', onNotification);
    socket.on('connect', onConnect);
    return () => {
      socket.off('notification:new', onNotification);
      socket.off('connect', onConnect);
    };
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    loadFirstPage,
    loadMore,
    refreshCount,
    receive,
    markRead,
    markAllRead,
    attach,
  };
}
