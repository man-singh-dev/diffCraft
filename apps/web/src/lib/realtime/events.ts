import { ReviewRoomEventSchemas, type ReviewRoomEvents, type Thread } from '@diffcraft/shared';

export type ReviewRoomEventName = keyof ReviewRoomEvents;

export const REVIEW_ROOM_EVENTS = Object.keys(ReviewRoomEventSchemas) as ReviewRoomEventName[];

export function parseRoomEvent<E extends ReviewRoomEventName>(
  event: E,
  payload: unknown,
  reviewId: string | null,
): ReviewRoomEvents[E] | null {
  if (reviewId === null) return null;
  const parsed = ReviewRoomEventSchemas[event].safeParse(payload);
  if (!parsed.success || parsed.data.reviewId !== reviewId) return null;
  return parsed.data as ReviewRoomEvents[E];
}

// ISO timestamps in one format (UTC, milliseconds) compare correctly as strings.
export function isNotOlder(at: string, appliedAt: string | undefined): boolean {
  return appliedAt === undefined || at >= appliedAt;
}

export function upsertThread(threads: Thread[], thread: Thread): Thread[] {
  const index = threads.findIndex((t) => t.id === thread.id);
  if (index === -1) return [...threads, thread];
  return threads.map((t, i) => (i === index ? thread : t));
}

export interface ResyncResult {
  threads: Thread[];
  appliedAt: Map<string, string>;
}

// Threads changed by an event newer than the refetch keep the event's version.
export function mergeResync(
  current: Thread[],
  appliedAt: ReadonlyMap<string, string>,
  fetched: Thread[],
  loadedAt: string,
): ResyncResult {
  const currentById = new Map(current.map((t) => [t.id, t]));
  const nextAt = new Map<string, string>();
  const threads = fetched.map((thread) => {
    const at = appliedAt.get(thread.id);
    const local = currentById.get(thread.id);
    if (at !== undefined && at > loadedAt && local) {
      nextAt.set(thread.id, at);
      return local;
    }
    nextAt.set(thread.id, loadedAt);
    return thread;
  });
  const fetchedIds = new Set(fetched.map((t) => t.id));
  for (const thread of current) {
    const at = appliedAt.get(thread.id);
    if (!fetchedIds.has(thread.id) && at !== undefined && at > loadedAt) {
      threads.push(thread);
      nextAt.set(thread.id, at);
    }
  }
  return { threads, appliedAt: nextAt };
}
