'use client';

import { useEffect, useRef, useState } from 'react';
import { realtimeEnabled } from './config';
import { getRealtimeConnection } from './connection';
import {
  subscribeToReviewRoom,
  type ReviewRoomHandlers,
  type ReviewRoomStatus,
} from './review-room';

export interface UseReviewRoomOptions extends ReviewRoomHandlers {
  workspaceId: string;
  reviewNumber: string;
}

export function useReviewRoom({
  workspaceId,
  reviewNumber,
  ...handlers
}: UseReviewRoomOptions): ReviewRoomStatus {
  // Same value on the server and in the browser, so hydration matches.
  const [status, setStatus] = useState<ReviewRoomStatus>(
    realtimeEnabled ? 'connecting' : 'disabled',
  );
  const latest = useRef(handlers);
  useEffect(() => {
    latest.current = handlers;
  });

  useEffect(() => {
    const connection = getRealtimeConnection();
    const number = Number(reviewNumber);
    if (!connection || !Number.isSafeInteger(number)) return;
    return subscribeToReviewRoom(connection, {
      workspaceId,
      reviewNumber: number,
      onStatus: setStatus,
      onThread: (event) => latest.current.onThread?.(event),
      onReviewChanged: (event) => latest.current.onReviewChanged?.(event),
      onReviewDeleted: (event) => latest.current.onReviewDeleted?.(event),
      onPresence: (event) => latest.current.onPresence?.(event),
      onResync: () => latest.current.onResync?.(),
    });
  }, [workspaceId, reviewNumber]);

  return status;
}
