'use client';

import Link from 'next/link';
import { createContext, useContext } from 'react';
import type { ReviewRoomStatus } from '@/lib/realtime/review-room';
import { textLink } from './styles';

export interface ReviewLiveState {
  status: ReviewRoomStatus;
  deleted: boolean;
  workspaceId: string;
}

export const ReviewLiveContext = createContext<ReviewLiveState | null>(null);

const INDICATOR: Partial<Record<ReviewRoomStatus, { label: string; dot: string; text: string }>> = {
  live: { label: 'Live', dot: 'bg-emerald-400', text: 'text-emerald-300' },
  reconnecting: { label: 'Reconnecting…', dot: 'bg-amber-400', text: 'text-amber-300' },
  offline: { label: 'Offline', dot: 'bg-slate-500', text: 'text-slate-400' },
};

export function LiveStatus() {
  const live = useContext(ReviewLiveContext);
  const indicator = live && INDICATOR[live.status];
  if (!indicator) return null;
  return (
    <span
      role="status"
      title="Live updates"
      className={`inline-flex items-center gap-1.5 text-xs font-medium ${indicator.text}`}
    >
      <span aria-hidden="true" className={`h-2 w-2 rounded-full ${indicator.dot}`} />
      <span className="sr-only">Live updates: </span>
      {indicator.label}
    </span>
  );
}

export function ReviewDeletedBanner() {
  const live = useContext(ReviewLiveContext);
  if (!live?.deleted) return null;
  return (
    <p
      role="alert"
      className="rounded-xl border border-rose-800 bg-rose-950/50 px-4 py-3 text-sm text-rose-200"
    >
      This review was deleted.{' '}
      <Link href={`/workspaces/${live.workspaceId}/reviews`} className={textLink}>
        Back to all reviews
      </Link>
    </p>
  );
}
