'use client';

import type { Comment, Thread, ThreadStatus, WorkspaceRole } from '@diffcraft/shared';
import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import {
  createThread,
  deleteComment,
  editComment,
  replyToThread,
  setThreadStatus,
} from '@/lib/comment-actions';
import type { CommentActionError, CommentActionResult } from '@/lib/comment-errors';
import { groupThreadsByKey, targetKey, type LineTarget } from '@/lib/thread-anchors';

export interface CommentsViewer {
  userId: string;
  role: WorkspaceRole;
}

interface CommentsContextValue {
  workspaceId: string;
  reviewNumber: string;
  viewer: CommentsViewer;
  /** Null once the review author's account is deleted. */
  reviewAuthorId: string | null;
  threads: Thread[];
  /** True when the threads couldn't be loaded: commenting is off. */
  loadFailed: boolean;
  threadsForKeys: (keys: string[]) => Thread[];
  /** The line whose composer is open (one at a time), or null. */
  composer: LineTarget | null;
  openComposer: (target: LineTarget | null) => void;
  // Each returns the error to show, or null on success; state is updated from the API's response.
  startThread: (target: LineTarget | null, body: string) => Promise<CommentActionError | null>;
  reply: (threadId: string, body: string) => Promise<CommentActionError | null>;
  edit: (threadId: string, commentId: string, body: string) => Promise<CommentActionError | null>;
  remove: (threadId: string, commentId: string) => Promise<CommentActionError | null>;
  setStatus: (threadId: string, status: ThreadStatus) => Promise<CommentActionError | null>;
}

const CommentsContext = createContext<CommentsContextValue | null>(null);

/** The comments state, or null outside a CommentsProvider (e.g. a diff rendered on its own). */
export function useComments(): CommentsContextValue | null {
  return useContext(CommentsContext);
}

const NETWORK_ERROR: CommentActionError = {
  code: 'failed',
  message: "Couldn't reach the server. Check your connection and try again.",
};

/** Runs a Server Action; a thrown error (network, or an action id from an older deploy) is a failure. */
async function run<T>(
  action: () => Promise<CommentActionResult<T>>,
): Promise<CommentActionResult<T>> {
  try {
    return await action();
  } catch {
    return { ok: false, error: NETWORK_ERROR };
  }
}

/**
 * Holds a review's threads on the files page and the review page. Changes go through the comment
 * Server Actions and update this state from the API's response, without router.refresh(), so the
 * page's diffs aren't fetched and highlighted again.
 */
export function CommentsProvider({
  workspaceId,
  reviewNumber,
  viewer,
  reviewAuthorId,
  initialThreads,
  children,
}: {
  workspaceId: string;
  reviewNumber: string;
  viewer: CommentsViewer;
  reviewAuthorId: string | null;
  /** Null when they couldn't be loaded. */
  initialThreads: Thread[] | null;
  children: React.ReactNode;
}) {
  const [threads, setThreads] = useState<Thread[]>(initialThreads ?? []);
  const [composer, setComposer] = useState<LineTarget | null>(null);

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
        setThreads((list) => [...list, result.data]);
        if (target)
          setComposer((open) => (open && targetKey(open) === targetKey(target) ? null : open));
        return null;
      },
      async reply(threadId, body) {
        const result = await run(() =>
          replyToThread(workspaceId, reviewNumber, threadId, { body }),
        );
        if (!result.ok) return result.error;
        updateComments(threadId, (comments) => [...comments, result.data]);
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

  return <CommentsContext.Provider value={value}>{children}</CommentsContext.Provider>;
}
