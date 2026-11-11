'use client';

import Link from 'next/link';
import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import {
  getUnreadCount,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from '@/lib/api-client';
import { badgeText, bellLabel, notificationHref, notificationText } from '@/lib/notifications';
import { createNotificationsStore, type NotificationsApi } from '@/lib/notifications-store';
import { getRealtimeConnection } from '@/lib/realtime/connection';
import { LocalTime } from './local-time';
import { textLink } from './styles';

const api: NotificationsApi = {
  list: (cursor) => listNotifications(cursor),
  unreadCount: () => getUnreadCount(),
  markRead: (id) => markNotificationRead(id),
  markAllRead: () => markAllNotificationsRead(),
};

const FOCUSABLE = 'a[href], button:not([disabled])';

export function NotificationBell({ initialUnread }: { initialUnread: number }) {
  const [store] = useState(() => createNotificationsStore(initialUnread, api));
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  useEffect(() => {
    const connection = getRealtimeConnection();
    return connection ? store.attach(connection) : undefined;
  }, [store]);

  useEffect(() => {
    if (!open) return;
    const { loaded, loading } = store.getState();
    if (!loaded && !loading) void store.loadFirstPage();
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open, store]);

  function close() {
    setOpen(false);
    buttonRef.current?.focus();
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (!open) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const items = [...(panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
    if (items.length === 0) return;
    event.preventDefault();
    const index = items.indexOf(document.activeElement as HTMLElement);
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? items.length - 1
          : event.key === 'ArrowDown'
            ? (index + 1) % items.length
            : (index - 1 + items.length) % items.length;
    items[next]?.focus();
  }

  function onSelect(event: React.MouseEvent<HTMLAnchorElement>, id: string, href: string) {
    void store.markRead(id);
    setOpen(false);
    const target = new URL(href, window.location.href);
    // Same page, new fragment: a real hashchange lets the page find the thread (Next.js navigation fires none).
    if (target.pathname === window.location.pathname && target.hash) {
      event.preventDefault();
      window.location.hash = target.hash;
    }
  }

  const badge = badgeText(state.unread);
  const emptyText = state.error
    ? null
    : state.loading || !state.loaded
      ? 'Loading…'
      : 'No notifications yet.';
  const hasUnread = state.unread > 0 || state.items.some((n) => n.readAt === null);

  return (
    <div ref={rootRef} className="relative" onKeyDown={onKeyDown}>
      <button
        ref={buttonRef}
        type="button"
        aria-label={bellLabel(state.unread)}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
        className="relative rounded-md p-1.5 text-slate-300 transition hover:bg-slate-800 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className="h-5 w-5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M15 17h5l-1.4-1.4A2 2 0 0 1 18 14.2V11a6 6 0 1 0-12 0v3.2a2 2 0 0 1-.6 1.4L4 17h5m6 0a3 3 0 1 1-6 0m6 0H9"
          />
        </svg>
        {badge && (
          <span
            aria-hidden="true"
            className="absolute -right-1 -top-1 min-w-[1.1rem] rounded-full bg-violet-500 px-1 text-center text-[10px] font-bold leading-[1.1rem] text-white"
          >
            {badge}
          </span>
        )}
      </button>

      {open && (
        <div
          ref={panelRef}
          id={panelId}
          role="region"
          aria-label="Notifications"
          className="absolute right-0 top-full z-20 mt-2 max-h-[70vh] w-80 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-xl border border-slate-700 bg-slate-900 shadow-xl"
        >
          <div className="flex items-center justify-between gap-2 border-b border-slate-800 px-3 py-2">
            <h2 className="text-sm font-semibold text-slate-100">Notifications</h2>
            {hasUnread && (
              <button
                type="button"
                onClick={() => void store.markAllRead()}
                className={`${textLink} text-xs`}
              >
                Mark all as read
              </button>
            )}
          </div>

          {state.items.length === 0 ? (
            emptyText && <p className="px-3 py-4 text-sm text-slate-400">{emptyText}</p>
          ) : (
            <ul className="divide-y divide-slate-800">
              {state.items.map((n) => {
                const href = notificationHref(n);
                const unread = n.readAt === null;
                return (
                  <li key={n.id}>
                    <Link
                      href={href}
                      onClick={(event) => onSelect(event, n.id, href)}
                      className={`flex gap-2 px-3 py-2.5 text-sm hover:bg-slate-800 focus-visible:bg-slate-800 focus-visible:outline-none ${
                        unread ? 'bg-violet-950/40 text-slate-100' : 'text-slate-400'
                      }`}
                    >
                      <span
                        aria-hidden="true"
                        className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${unread ? 'bg-violet-400' : 'bg-transparent'}`}
                      />
                      <span className="min-w-0 space-y-0.5">
                        {unread && <span className="sr-only">Unread: </span>}
                        <span className="block break-words">{notificationText(n)}</span>
                        <span className="block text-xs text-slate-500">
                          <LocalTime iso={n.createdAt} />
                        </span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}

          {state.error && (
            <p role="alert" className="px-3 py-2 text-xs text-red-400">
              {state.error}
            </p>
          )}
          {state.nextCursor && (
            <div className="border-t border-slate-800 px-3 py-2">
              <button
                type="button"
                onClick={() => void store.loadMore()}
                disabled={state.loading}
                className={`${textLink} text-xs`}
              >
                {state.loading ? 'Loading…' : 'Load more'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
