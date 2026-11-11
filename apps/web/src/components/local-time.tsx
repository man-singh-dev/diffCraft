'use client';

import { useSyncExternalStore } from 'react';

export function formatTimestamp(iso: string, timeZone: string, dateOnly = false): string {
  return new Intl.DateTimeFormat('en', {
    dateStyle: 'medium',
    timeStyle: dateOnly ? undefined : 'short',
    timeZone,
  }).format(new Date(iso));
}

export function fullTimestamp(iso: string, timeZone: string): string {
  const full = new Intl.DateTimeFormat('en', {
    dateStyle: 'full',
    timeStyle: 'long',
    timeZone,
  }).format(new Date(iso));
  return `${full} (${timeZone})`;
}

const subscribe = () => () => {};
const browserTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
const noTimeZone = () => null;

export function LocalTime({ iso, dateOnly = false }: { iso: string; dateOnly?: boolean }) {
  // The server snapshot is also used while hydrating, so the first client render matches the HTML.
  const timeZone = useSyncExternalStore(subscribe, browserTimeZone, noTimeZone);
  const zone = timeZone ?? 'UTC';
  const label = formatTimestamp(iso, zone, dateOnly);

  return (
    <time dateTime={iso} title={fullTimestamp(iso, zone)}>
      {timeZone ? label : `${label} UTC`}
    </time>
  );
}
