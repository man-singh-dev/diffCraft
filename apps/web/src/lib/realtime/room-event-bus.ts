import type { AnalysisCompletedEvent, AnalysisStatusEvent } from '@diffcraft/shared';

export interface RoomListener {
  onAnalysisStatus?: (event: AnalysisStatusEvent) => void;
  onAnalysisCompleted?: (event: AnalysisCompletedEvent) => void;
  onResync?: () => void;
}

export interface RoomEventBus {
  subscribe: (listener: RoomListener) => () => void;
  emit: <K extends keyof RoomListener>(
    name: K,
    ...args: Parameters<NonNullable<RoomListener[K]>>
  ) => void;
}

// One review-room subscription per page: a second one would send its own review:leave and drop the shared socket from the room.
export function createRoomEventBus(): RoomEventBus {
  const listeners = new Set<RoomListener>();
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    emit(name, ...args) {
      for (const listener of listeners) {
        (listener[name] as ((...a: typeof args) => void) | undefined)?.(...args);
      }
    },
  };
}
