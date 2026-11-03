import type {
  Comment,
  CommentAnchorInput,
  CreateThreadRequest,
  DiffHunk,
  Thread,
  ThreadStatus,
} from '@diffcraft/shared';
import { and, asc, eq, inArray, isNull, ne, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import {
  comments,
  commentThreads,
  reviewFiles,
  reviews,
  users,
  type CommentThreadRow,
} from '../../db/schema/index.js';
import type { Database } from '../../plugins/db.js';
import { ReviewFileNotFoundError, ReviewNotFoundError } from '../reviews/errors.js';
import { CommentAnchorInvalidError } from './errors.js';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
type UserRef = Thread['createdBy'];

// Every query is scoped to the review *and* its workspace: a thread or comment id from the URL
// is never trusted on its own.
const reviewInWorkspace = (workspaceId: string, reviewId: string) =>
  sql`exists (select 1 from ${reviews} where ${reviews.id} = ${reviewId} and ${reviews.workspaceId} = ${workspaceId})`;

const threadInReview = (workspaceId: string, reviewId: string) =>
  and(eq(commentThreads.reviewId, reviewId), reviewInWorkspace(workspaceId, reviewId));

const userRef = (id: string | null, displayName: string | null): UserRef =>
  id !== null && displayName !== null ? { id, displayName } : null;

// ---- Reading -------------------------------------------------------------------------------

const commentColumns = {
  id: comments.id,
  threadId: comments.threadId,
  body: comments.body,
  createdAt: comments.createdAt,
  // In SQL, so both timestamps come from the database's clock.
  edited: sql<boolean>`${comments.updatedAt} > ${comments.createdAt} and ${comments.deletedAt} is null`,
  deletedAt: comments.deletedAt,
  authorId: users.id,
  authorName: users.displayName,
};

type CommentResult = {
  id: string;
  threadId: string;
  body: string;
  createdAt: Date;
  edited: boolean;
  deletedAt: Date | null;
  authorId: string | null;
  authorName: string | null;
};

function toComment(row: CommentResult): Comment {
  const deleted = row.deletedAt !== null;
  return {
    id: row.id,
    threadId: row.threadId,
    author: userRef(row.authorId, row.authorName),
    body: deleted ? '' : row.body,
    createdAt: row.createdAt.toISOString(),
    edited: row.edited,
    deleted,
  };
}

function selectComments(db: Database | Tx, where: SQL | undefined) {
  return db
    .select(commentColumns)
    .from(comments)
    .leftJoin(users, eq(comments.authorId, users.id))
    .where(where)
    .orderBy(asc(comments.createdAt), asc(comments.id));
}

const creator = alias(users, 'creator');
const resolver = alias(users, 'resolver');

function selectThreads(db: Database | Tx, where: SQL | undefined) {
  return (
    db
      .select({
        thread: commentThreads,
        creatorName: creator.displayName,
        resolverName: resolver.displayName,
        filePosition: reviewFiles.position,
      })
      .from(commentThreads)
      .leftJoin(creator, eq(commentThreads.createdBy, creator.id))
      .leftJoin(resolver, eq(commentThreads.resolvedBy, resolver.id))
      .leftJoin(reviewFiles, eq(commentThreads.fileId, reviewFiles.id))
      .where(where)
      // Review-level threads first, then in diff order: file, side (old before new), line.
      .orderBy(
        sql`${commentThreads.fileId} is not null`,
        asc(reviewFiles.position),
        sql`case ${commentThreads.side} when 'old' then 0 else 1 end`,
        asc(commentThreads.line),
        asc(commentThreads.createdAt),
        asc(commentThreads.id),
      )
  );
}

function toThread(
  {
    thread,
    creatorName,
    resolverName,
  }: { thread: CommentThreadRow; creatorName: string | null; resolverName: string | null },
  threadComments: Comment[],
): Thread {
  const { fileId, side, line, lineContent } = thread;
  return {
    id: thread.id,
    reviewId: thread.reviewId,
    anchor:
      fileId !== null && side !== null && line !== null && lineContent !== null
        ? { fileId, side, line, lineContent }
        : null,
    status: thread.status,
    resolvedBy: userRef(thread.resolvedBy, resolverName),
    resolvedAt: thread.resolvedAt?.toISOString() ?? null,
    createdBy: userRef(thread.createdBy, creatorName),
    createdAt: thread.createdAt.toISOString(),
    comments: threadComments,
  };
}

/**
 * All threads of a review with their comments, in two queries whatever the number of threads:
 * the threads, then all their comments, grouped in memory.
 */
export async function listThreads(
  db: Database,
  workspaceId: string,
  reviewId: string,
): Promise<Thread[]> {
  const threadRows = await selectThreads(db, threadInReview(workspaceId, reviewId));
  if (threadRows.length === 0) return [];

  const commentRows = await selectComments(
    db,
    inArray(
      comments.threadId,
      threadRows.map((row) => row.thread.id),
    ),
  );
  const byThread = new Map<string, Comment[]>();
  for (const row of commentRows) {
    const list = byThread.get(row.threadId) ?? [];
    list.push(toComment(row));
    byThread.set(row.threadId, list);
  }
  return threadRows.map((row) => toThread(row, byThread.get(row.thread.id) ?? []));
}

/** One thread with its comments; null unless it belongs to this review in this workspace. */
export async function getThread(
  db: Database | Tx,
  workspaceId: string,
  reviewId: string,
  threadId: string,
): Promise<Thread | null> {
  const [row] = await selectThreads(
    db,
    and(eq(commentThreads.id, threadId), threadInReview(workspaceId, reviewId)),
  );
  if (!row) return null;
  const threadComments = await selectComments(db, eq(comments.threadId, threadId));
  return toThread(row, threadComments.map(toComment));
}

// Comments are scoped through their thread, which is scoped through the review.
const commentInReview = (workspaceId: string, reviewId: string) =>
  inArray(
    comments.threadId,
    sql`(select ${commentThreads.id} from ${commentThreads} where ${threadInReview(workspaceId, reviewId)})`,
  );

/** One comment; null unless it is in a thread of this review in this workspace. */
export async function getComment(
  db: Database | Tx,
  workspaceId: string,
  reviewId: string,
  commentId: string,
): Promise<Comment | null> {
  const [row] = await selectComments(
    db,
    and(eq(comments.id, commentId), commentInReview(workspaceId, reviewId)),
  );
  return row ? toComment(row) : null;
}

// ---- Writing -------------------------------------------------------------------------------

/** The text of the line an anchor points at, or null if that line isn't on that side of the hunks. */
export function findAnchorLine(hunks: DiffHunk[], side: CommentAnchorInput['side'], line: number) {
  for (const hunk of hunks) {
    for (const diffLine of hunk.lines) {
      // Deleted and context lines exist on the old side; added and context lines on the new.
      const number =
        side === 'old'
          ? diffLine.type !== 'add' && diffLine.oldNumber
          : diffLine.type !== 'del' && diffLine.newNumber;
      if (number === line) return diffLine.content;
    }
  }
  return null;
}

async function resolveAnchor(
  db: Database,
  workspaceId: string,
  reviewId: string,
  anchor: CommentAnchorInput,
) {
  const [file] = await db
    .select({ isBinary: reviewFiles.isBinary, hunks: reviewFiles.hunks })
    .from(reviewFiles)
    .innerJoin(reviews, eq(reviewFiles.reviewId, reviews.id))
    .where(
      and(
        eq(reviewFiles.id, anchor.fileId),
        eq(reviewFiles.reviewId, reviewId),
        eq(reviews.workspaceId, workspaceId),
      ),
    );
  if (!file) throw new ReviewFileNotFoundError();
  if (file.isBinary)
    throw new CommentAnchorInvalidError('Binary files have no lines to comment on.');

  const lineContent = findAnchorLine(file.hunks, anchor.side, anchor.line);
  if (lineContent === null) throw new CommentAnchorInvalidError();
  return { ...anchor, lineContent };
}

/**
 * Starts a thread with its first comment, in one transaction. `input` must already be validated.
 * Throws ReviewNotFoundError, ReviewFileNotFoundError (the file isn't in this review) or
 * CommentAnchorInvalidError (binary file, or the line isn't on that side of the diff).
 */
export async function createThread(
  db: Database,
  {
    workspaceId,
    reviewId,
    authorId,
    input,
  }: { workspaceId: string; reviewId: string; authorId: string; input: CreateThreadRequest },
): Promise<Thread> {
  let anchor: Awaited<ReturnType<typeof resolveAnchor>> | null = null;
  if (input.anchor) {
    anchor = await resolveAnchor(db, workspaceId, reviewId, input.anchor);
  } else {
    const [review] = await db
      .select({ id: reviews.id })
      .from(reviews)
      .where(and(eq(reviews.id, reviewId), eq(reviews.workspaceId, workspaceId)));
    if (!review) throw new ReviewNotFoundError();
  }

  return db.transaction(async (tx) => {
    const [thread] = await tx
      .insert(commentThreads)
      .values({
        reviewId,
        fileId: anchor?.fileId ?? null,
        side: anchor?.side ?? null,
        line: anchor?.line ?? null,
        lineContent: anchor?.lineContent ?? null,
        createdBy: authorId,
      })
      .returning({ id: commentThreads.id });
    if (!thread) throw new Error('INSERT ... RETURNING returned no row');

    await tx.insert(comments).values({ threadId: thread.id, authorId, body: input.body });

    const created = await getThread(tx, workspaceId, reviewId, thread.id);
    if (!created) throw new Error('thread not found after insert');
    return created;
  });
}

/** Adds a comment to a thread; null if the thread isn't in this review. `body` must be validated. */
export async function addReply(
  db: Database,
  {
    workspaceId,
    reviewId,
    threadId,
    authorId,
    body,
  }: { workspaceId: string; reviewId: string; threadId: string; authorId: string; body: string },
): Promise<Comment | null> {
  const [thread] = await db
    .select({ id: commentThreads.id })
    .from(commentThreads)
    .where(and(eq(commentThreads.id, threadId), threadInReview(workspaceId, reviewId)));
  if (!thread) return null;

  const [row] = await db
    .insert(comments)
    .values({ threadId: thread.id, authorId, body })
    .returning({ id: comments.id });
  return row ? getComment(db, workspaceId, reviewId, row.id) : null;
}

/** Replaces a comment's body; null if it isn't in this review or is deleted. */
export async function editComment(
  db: Database,
  workspaceId: string,
  reviewId: string,
  commentId: string,
  body: string,
): Promise<Comment | null> {
  const [row] = await db
    .update(comments)
    .set({ body, updatedAt: sql`now()` })
    .where(
      and(
        eq(comments.id, commentId),
        isNull(comments.deletedAt),
        commentInReview(workspaceId, reviewId),
      ),
    )
    .returning({ id: comments.id });
  return row ? getComment(db, workspaceId, reviewId, row.id) : null;
}

/**
 * Soft-deletes a comment: the row stays (so replies keep their place) with an empty body.
 * Null if it isn't in this review or is already deleted.
 */
export async function deleteComment(
  db: Database,
  workspaceId: string,
  reviewId: string,
  commentId: string,
): Promise<Comment | null> {
  const [row] = await db
    .update(comments)
    .set({ body: '', deletedAt: sql`now()`, updatedAt: sql`now()` })
    .where(
      and(
        eq(comments.id, commentId),
        isNull(comments.deletedAt),
        commentInReview(workspaceId, reviewId),
      ),
    )
    .returning({ id: comments.id });
  return row ? getComment(db, workspaceId, reviewId, row.id) : null;
}

/**
 * Sets a thread's status. Idempotent: setting the status it already has changes nothing, so
 * resolving twice keeps the first resolver and time. Null if the thread isn't in this review.
 */
export async function setThreadStatus(
  db: Database,
  {
    workspaceId,
    reviewId,
    threadId,
    userId,
    status,
  }: {
    workspaceId: string;
    reviewId: string;
    threadId: string;
    userId: string;
    status: ThreadStatus;
  },
): Promise<Thread | null> {
  await db
    .update(commentThreads)
    .set(
      status === 'resolved'
        ? { status, resolvedBy: userId, resolvedAt: sql`now()` }
        : { status, resolvedBy: null, resolvedAt: null },
    )
    .where(
      and(
        eq(commentThreads.id, threadId),
        ne(commentThreads.status, status),
        threadInReview(workspaceId, reviewId),
      ),
    );
  return getThread(db, workspaceId, reviewId, threadId);
}
