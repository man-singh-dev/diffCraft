'use client';

import type {
  Comment,
  PresenceEvent,
  Thread,
  ThreadStatus,
  WorkspaceRole,
} from '@diffcraft/shared';
import { useRouter } from 'next/navigation';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  createThread,
  deleteComment,
  editComment,
  loadThreads,
  replyToThread,
  setThreadStatus,
} from '@/lib/comment-actions';
import type { CommentActionError, CommentActionResult } from '@/lib/comment-errors';
import { debounce } from '@/lib/realtime/debounce';
import { isNotOlder, mergeResync, upsertThread } from '@/lib/realtime/events';
import { newerPresence } from '@/lib/realtime/presence';
import { createRoomEventBus, type RoomEventBus } from '@/lib/realtime/room-event-bus';
import { useReviewRoom } from '@/lib/realtime/use-review-room';
import { groupThreadsByKey, targetKey, type LineTarget } from '@/lib/thread-anchors';
import { ReviewLiveContext, type ReviewLiveState } from './review-live';

export interface CommentsViewer {
  userId: string;
  role: WorkspaceRole;
}

interface CommentsContextValue {
  workspaceId: string;
  reviewNumber: string;
  viewer: CommentsViewer;
  reviewAuthorId: string | null;
  threads: Thread[];
  loadFailed: boolean;
  threadsForKeys: (keys: string[]) => Thread[];
  composer: LineTarget | null;
  openComposer: (target: LineTarget | null) => void;
  startThread: (target: LineTarget | null, body: string) => Promise<CommentActionError | null>;
  reply: (threadId: string, body: string) => Promise<CommentActionError | null>;
  edit: (threadId: string, commentId: string, body: string) => Promise<CommentActionError | null>;
  remove: (threadId: string, commentId: string) => Promise<CommentActionError | null>;
  setStatus: (threadId: string, status: ThreadStatus) => Promise<CommentActionError | null>;
}

const CommentsContext = createContext<CommentsContextValue | null>(null);
const RoomEventsContext = createContext<RoomEventBus | null>(null);

export function useRoomEvents(): RoomEventBus | null {
  return useContext(RoomEventsContext);
}

/** Null outside a CommentsProvider (e.g. a diff rendered on its own). */
export function useComments(): CommentsContextValue | null {
  return useContext(CommentsContext);
}

const NETWORK_ERROR: CommentActionError = {
  code: 'failed',
  message: "Couldn't reach the server. Check your connection and try again.",
};

/** A thrown error (network, or an action id from an older deploy) is a failure. */
async function run<T>(
  action: () => Promise<CommentActionResult<T>>,
): Promise<CommentActionResult<T>> {
  try {
    return await action();
  } catch {
    return { ok: false, error: NETWORK_ERROR };
  }
}

const REFRESH_DEBOUNCE_MS = 300;

const upsertComment = (comments: Comment[], comment: Comment) =>
  comments.some((c) => c.id === comment.id)
    ? comments.map((c) => (c.id === comment.id ? comment : c))
    : [...comments, comment];

// State is updated from the API's response, not router.refresh(), so the page's diffs aren't fetched and highlighted again.
export function CommentsProvider({
  workspaceId,
  reviewNumber,
  viewer,
  reviewAuthorId,
  initialThreads,
  loadedAt,
  children,
}: {
  workspaceId: string;
  reviewNumber: string;
  viewer: CommentsViewer;
  reviewAuthorId: string | null;
  initialThreads: Thread[] | null;
  /** When the page fetched initialThreads: they count as this new against live events. */
  loadedAt: string;
  children: React.ReactNode;
}) {
  const [threads, setThreads] = useState<Thread[]>(initialThreads ?? []);
  const [composer, setComposer] = useState<LineTarget | null>(null);
  const [deleted, setDeleted] = useState(false);
  const [presence, setPresence] = useState<PresenceEvent | null>(null);
  const appliedAt = useRef<Map<string, string> | null>(null);
  appliedAt.current ??= new Map((initialThreads ?? []).map((t) => [t.id, loadedAt]));
  const resyncCount = useRef(0);
  const [bus] = useState(createRoomEventBus);

  const router = useRouter();
  const refresh = useMemo(() => debounce(() => router.refresh(), REFRESH_DEBOUNCE_MS), [router]);
  useEffect(() => () => refresh.cancel(), [refresh]);

  const status = useReviewRoom({
    workspaceId,
    reviewNumber,
    onThread(event) {
      const applied = appliedAt.current!;
      if (!isNotOlder(event.at, applied.get(event.thread.id))) return;
      applied.set(event.thread.id, event.at);
      setThreads((list) => upsertThread(list, event.thread));
    },
    onReviewChanged: refresh,
    onAnalysisStatus: (event) => bus.emit('onAnalysisStatus', event),
    onAnalysisCompleted: (event) => bus.emit('onAnalysisCompleted', event),
    onPresence: (event) => setPresence((current) => newerPresence(current, event)),
    onReviewDeleted() {
      refresh.cancel();
      setDeleted(true);
    },
    async onResync() {
      // Another instance may answer after a reconnect, and its clock may be behind the last one's.
      setPresence(null);
      bus.emit('onResync');
      const current = ++resyncCount.current;
      const result = await loadThreads(workspaceId, reviewNumber).catch(() => null);
      if (!result?.ok || current !== resyncCount.current) return;
      const { threads: fetched, loadedAt: fetchedAt } = result.data;
      // Idempotent, so React running the updater twice is harmless.
      setThreads((list) => {
        const merged = mergeResync(list, appliedAt.current!, fetched, fetchedAt);
        appliedAt.current = merged.appliedAt;
        return merged.threads;
      });
      refresh();
    },
  });
  const live = useMemo<ReviewLiveState>(
    () => ({ status, deleted, workspaceId, presence, viewerId: viewer.userId }),
    [status, deleted, workspaceId, presence, viewer.userId],
  );

  const byKey = useMemo(() => groupThreadsByKey(threads), [threads]);
  const threadsForKeys = useCallback(
    (keys: string[]) => {
      const found = keys.flatMap((key) => byKey.get(key) ?? []);
      // A context row matches two keys: keep the threads in the order they were started.
      return keys.length > 1 ? found.sort((a, b) => a.createdAt.localeCompare(b.createdAt)) : found;
    },
    [byKey],
  );

  const replaceThread = useCallback((thread: Thread) => {
    setThreads((list) => list.map((t) => (t.id === thread.id ? thread : t)));
  }, []);
  const updateComments = useCallback(
    (threadId: string, change: (comments: Comment[]) => Comment[]) => {
      setThreads((list) =>
        list.map((t) => (t.id === threadId ? { ...t, comments: change(t.comments) } : t)),
      );
    },
    [],
  );

  const value = useMemo<CommentsContextValue>(
    () => ({
      workspaceId,
      reviewNumber,
      viewer,
      reviewAuthorId,
      threads,
      loadFailed: initialThreads === null,
      threadsForKeys,
      composer,
      openComposer: setComposer,
      async startThread(target, body) {
        const input = target
          ? { body, anchor: { fileId: target.fileId, side: target.side, line: target.line } }
          : { body };
        const result = await run(() => createThread(workspaceId, reviewNumber, input));
        if (!result.ok) return result.error;
        // The live event for this thread may have arrived first.
        setThreads((list) =>
          list.some((t) => t.id === result.data.id) ? list : [...list, result.data],
        );
        if (target)
          setComposer((open) => (open && targetKey(open) === targetKey(target) ? null : open));
        return null;
      },
      async reply(threadId, body) {
        const result = await run(() =>
          replyToThread(workspaceId, reviewNumber, threadId, { body }),
        );
        if (!result.ok) return result.error;
        updateComments(threadId, (comments) => upsertComment(comments, result.data));
        return null;
      },
      async edit(threadId, commentId, body) {
        const result = await run(() =>
          editComment(workspaceId, reviewNumber, threadId, commentId, { body }),
        );
        if (!result.ok) return result.error;
        updateComments(threadId, (comments) =>
          comments.map((c) => (c.id === commentId ? result.data : c)),
        );
        return null;
      },
      async remove(threadId, commentId) {
        const result = await run(() =>
          deleteComment(workspaceId, reviewNumber, threadId, commentId),
        );
        if (!result.ok) return result.error;
        updateComments(threadId, (comments) =>
          comments.map((c) => (c.id === commentId ? result.data : c)),
        );
        return null;
      },
      async setStatus(threadId, status) {
        const result = await run(() =>
          setThreadStatus(workspaceId, reviewNumber, threadId, { status }),
        );
        if (!result.ok) return result.error;
        replaceThread(result.data);
        return null;
      },
    }),
    [
      workspaceId,
      reviewNumber,
      viewer,
      reviewAuthorId,
      threads,
      initialThreads,
      threadsForKeys,
      composer,
      updateComments,
      replaceThread,
    ],
  );

  return (
    <ReviewLiveContext.Provider value={live}>
      <RoomEventsContext.Provider value={bus}>
        <CommentsContext.Provider value={value}>{children}</CommentsContext.Provider>
      </RoomEventsContext.Provider>
    </ReviewLiveContext.Provider>
  );
}
