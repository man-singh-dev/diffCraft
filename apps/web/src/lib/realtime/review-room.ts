import type {
  AnalysisCompletedEvent,
  AnalysisStatusEvent,
  PresenceEvent,
  ReviewChangedEvent,
  ReviewDeletedEvent,
  ReviewJoinAck,
  ThreadUpsertEvent,
} from '@diffcraft/shared';
import type { ConnectionStatus, RealtimeConnection } from './connection';
import { parseRoomEvent, REVIEW_ROOM_EVENTS, type ReviewRoomEventName } from './events';

export type ReviewRoomStatus = ConnectionStatus | 'disabled';

export interface ReviewRoomHandlers {
  onThread?: (event: ThreadUpsertEvent) => void;
  onReviewChanged?: (event: ReviewChangedEvent) => void;
  onReviewDeleted?: (event: ReviewDeletedEvent) => void;
  onPresence?: (event: PresenceEvent) => void;
  onAnalysisStatus?: (event: AnalysisStatusEvent) => void;
  onAnalysisCompleted?: (event: AnalysisCompletedEvent) => void;
  onResync?: () => void;
}

export interface ReviewRoomOptions extends ReviewRoomHandlers {
  workspaceId: string;
  reviewNumber: number;
  onStatus: (status: ReviewRoomStatus) => void;
}

export function subscribeToReviewRoom(
  connection: RealtimeConnection,
  { workspaceId, reviewNumber, onStatus, ...handlers }: ReviewRoomOptions,
): () => void {
  const { socket } = connection;
  let reviewId: string | null = null;
  let joined = false;
  let joinedBefore = false;
  let joinFailed = false;
  let attempt = 0;
  let disposed = false;

  const report = () => {
    if (disposed) return;
    const status = connection.status();
    if (joinFailed) onStatus('offline');
    else if (status !== 'live') onStatus(status);
    else if (joined) onStatus('live');
    else onStatus(joinedBefore ? 'reconnecting' : 'connecting');
  };

  const join = () => {
    const current = ++attempt;
    joined = false;
    joinFailed = false;
    report();
    socket.emit('review:join', { workspaceId, reviewNumber }, (ack: ReviewJoinAck) => {
      // An answer to an earlier attempt (before a reconnect) is stale.
      if (disposed || current !== attempt) return;
      if (!ack?.ok) {
        joinFailed = true;
        report();
        return;
      }
      reviewId = ack.reviewId;
      joined = true;
      const rejoined = joinedBefore;
      joinedBefore = true;
      report();
      // Rooms are lost on disconnect, and events sent meanwhile are gone: refetch once back in the room.
      if (rejoined) handlers.onResync?.();
    });
  };

  const onDisconnect = () => {
    attempt += 1;
    joined = false;
    report();
  };

  const dispatch: Record<ReviewRoomEventName, (payload: unknown) => void> = {
    'thread:upsert': (payload) => {
      const event = joined && parseRoomEvent('thread:upsert', payload, reviewId);
      if (event) handlers.onThread?.(event);
    },
    'review:changed': (payload) => {
      const event = joined && parseRoomEvent('review:changed', payload, reviewId);
      if (event) handlers.onReviewChanged?.(event);
    },
    'review:deleted': (payload) => {
      const event = joined && parseRoomEvent('review:deleted', payload, reviewId);
      if (event) handlers.onReviewDeleted?.(event);
    },
    presence: (payload) => {
      const event = joined && parseRoomEvent('presence', payload, reviewId);
      if (event) handlers.onPresence?.(event);
    },
    'analysis:status': (payload) => {
      const event = joined && parseRoomEvent('analysis:status', payload, reviewId);
      if (event) handlers.onAnalysisStatus?.(event);
    },
    'analysis:completed': (payload) => {
      const event = joined && parseRoomEvent('analysis:completed', payload, reviewId);
      if (event) handlers.onAnalysisCompleted?.(event);
    },
  };

  socket.on('connect', join);
  socket.on('disconnect', onDisconnect);
  for (const name of REVIEW_ROOM_EVENTS) socket.on(name, dispatch[name]);
  const unsubscribe = connection.subscribe(report);

  if (socket.connected) join();
  else report();

  return () => {
    disposed = true;
    unsubscribe();
    socket.off('connect', join);
    socket.off('disconnect', onDisconnect);
    for (const name of REVIEW_ROOM_EVENTS) socket.off(name, dispatch[name]);
    // The server ignores a leave without an acknowledgement callback.
    if (socket.connected && reviewId) socket.emit('review:leave', { reviewId }, () => {});
  };
}
