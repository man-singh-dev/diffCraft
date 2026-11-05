import {
  parsePatch,
  type CreateReviewRequest,
  type Review,
  type ReviewFile,
  type ReviewFileDiff,
  type ReviewStatus,
  type UpdateReviewRequest,
} from '@diffcraft/shared';
import { and, asc, desc, eq, sql, type SQL } from 'drizzle-orm';
import { reviewFiles, reviews, users, workspaces, type ReviewRow } from '../../db/schema/index.js';
import type { Database } from '../../plugins/db.js';
import { WorkspaceNotFoundError } from '../workspaces/require-workspace-role.js';
import { encodeCursor, type ReviewCursor } from './cursor.js';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

export function toReview(row: ReviewRow, author: Review['author']): Review {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    number: row.number,
    title: row.title,
    description: row.description,
    status: row.status,
    author,
    filesChanged: row.filesChanged,
    additions: row.additions,
    deletions: row.deletions,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function createReview(
  db: Database,
  {
    workspaceId,
    authorId,
    input,
  }: { workspaceId: string; authorId: string; input: CreateReviewRequest },
): Promise<Review> {
  // Outside the transaction: parsing is CPU work that shouldn't hold a row lock.
  const { files } = parsePatch(input.patch);
  const additions = files.reduce((sum, file) => sum + file.additions, 0);
  const deletions = files.reduce((sum, file) => sum + file.deletions, 0);

  return db.transaction(async (tx) => {
    const number = await nextReviewNumber(tx, workspaceId);
    const [row] = await tx
      .insert(reviews)
      .values({
        workspaceId,
        number,
        authorId,
        title: input.title,
        description: input.description,
        patch: input.patch,
        filesChanged: files.length,
        additions,
        deletions,
      })
      .returning();
    if (!row) throw new Error('INSERT ... RETURNING returned no row');

    // One statement for all files: 300 files × 9 values stays far below Postgres's 65,535 bind parameters.
    if (files.length > 0) {
      await tx.insert(reviewFiles).values(
        files.map((file, position) => ({
          reviewId: row.id,
          position,
          oldPath: file.oldPath,
          newPath: file.newPath,
          changeType: file.changeType,
          isBinary: file.isBinary,
          additions: file.additions,
          deletions: file.deletions,
          hunks: file.hunks,
        })),
      );
    }

    const [author] = await tx
      .select({ id: users.id, displayName: users.displayName })
      .from(users)
      .where(eq(users.id, authorId));
    return toReview(row, author ?? null);
  });
}

async function nextReviewNumber(tx: Tx, workspaceId: string): Promise<number> {
  const [counter] = await tx
    .update(workspaces)
    // updated_at is set to itself: a new review is not an edit of the workspace.
    .set({
      lastReviewNumber: sql`${workspaces.lastReviewNumber} + 1`,
      updatedAt: sql`${workspaces.updatedAt}`,
    })
    .where(eq(workspaces.id, workspaceId))
    .returning({ number: workspaces.lastReviewNumber });
  if (!counter) throw new WorkspaceNotFoundError();
  return counter.number;
}

const reviewWithAuthor = {
  review: reviews,
  authorId: users.id,
  authorName: users.displayName,
};

function fromJoinedRow({
  review,
  authorId,
  authorName,
}: {
  review: ReviewRow;
  authorId: string | null;
  authorName: string | null;
}): Review {
  return toReview(
    review,
    authorId !== null && authorName !== null ? { id: authorId, displayName: authorName } : null,
  );
}

async function findReview(db: Database, where: SQL | undefined): Promise<Review | null> {
  const [row] = await db
    .select(reviewWithAuthor)
    .from(reviews)
    .leftJoin(users, eq(reviews.authorId, users.id))
    .where(where);
  return row ? fromJoinedRow(row) : null;
}

export async function getReview(
  db: Database,
  workspaceId: string,
  reviewId: string,
): Promise<Review | null> {
  return findReview(db, and(eq(reviews.id, reviewId), eq(reviews.workspaceId, workspaceId)));
}

export async function getReviewByNumber(
  db: Database,
  workspaceId: string,
  number: number,
): Promise<Review | null> {
  return findReview(db, and(eq(reviews.workspaceId, workspaceId), eq(reviews.number, number)));
}

export interface ListReviewsOptions {
  status?: ReviewStatus;
  authorId?: string;
  limit: number;
  cursor?: ReviewCursor;
}

export async function listReviews(
  db: Database,
  workspaceId: string,
  { status, authorId, limit, cursor }: ListReviewsOptions,
): Promise<{ items: Review[]; nextCursor: string | null }> {
  const rows = await db
    .select({
      ...reviewWithAuthor,
      // Microseconds, as text: the cursor must not lose precision in a JS Date.
      cursorCreatedAt: sql<string>`to_char(${reviews.createdAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
    })
    .from(reviews)
    .leftJoin(users, eq(reviews.authorId, users.id))
    .where(
      and(
        eq(reviews.workspaceId, workspaceId),
        status !== undefined ? eq(reviews.status, status) : undefined,
        authorId !== undefined ? eq(reviews.authorId, authorId) : undefined,
        cursor !== undefined
          ? sql`(${reviews.createdAt}, ${reviews.id}) < (${cursor.createdAt}::timestamptz, ${cursor.id}::uuid)`
          : undefined,
      ),
    )
    .orderBy(desc(reviews.createdAt), desc(reviews.id))
    .limit(limit + 1);

  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    items: page.map(fromJoinedRow),
    nextCursor:
      rows.length > limit && last
        ? encodeCursor({ createdAt: last.cursorCreatedAt, id: last.review.id })
        : null,
  };
}

export async function updateReview(
  db: Database,
  workspaceId: string,
  reviewId: string,
  changes: UpdateReviewRequest,
): Promise<Review | null> {
  const [row] = await db
    .update(reviews)
    .set({
      ...(changes.title !== undefined && { title: changes.title }),
      ...(changes.description !== undefined && { description: changes.description }),
      ...(changes.status !== undefined && { status: changes.status }),
    })
    .where(and(eq(reviews.id, reviewId), eq(reviews.workspaceId, workspaceId)))
    .returning({ id: reviews.id });
  return row ? getReview(db, workspaceId, row.id) : null;
}

export async function deleteReview(
  db: Database,
  workspaceId: string,
  reviewId: string,
): Promise<boolean> {
  const deleted = await db
    .delete(reviews)
    .where(and(eq(reviews.id, reviewId), eq(reviews.workspaceId, workspaceId)))
    .returning({ id: reviews.id });
  return deleted.length > 0;
}

const reviewFileColumns = {
  id: reviewFiles.id,
  position: reviewFiles.position,
  oldPath: reviewFiles.oldPath,
  newPath: reviewFiles.newPath,
  changeType: reviewFiles.changeType,
  isBinary: reviewFiles.isBinary,
  additions: reviewFiles.additions,
  deletions: reviewFiles.deletions,
};

// review_files has no workspace_id, so these join reviews to scope by workspace as well.
const fileInWorkspace = (workspaceId: string, reviewId: string) =>
  and(eq(reviewFiles.reviewId, reviewId), eq(reviews.workspaceId, workspaceId));

export async function listReviewFiles(
  db: Database,
  workspaceId: string,
  reviewId: string,
): Promise<ReviewFile[]> {
  return db
    .select(reviewFileColumns)
    .from(reviewFiles)
    .innerJoin(reviews, eq(reviewFiles.reviewId, reviews.id))
    .where(fileInWorkspace(workspaceId, reviewId))
    .orderBy(asc(reviewFiles.position));
}

export async function getReviewFileDiff(
  db: Database,
  workspaceId: string,
  reviewId: string,
  fileId: string,
): Promise<ReviewFileDiff | null> {
  const [row] = await db
    .select({ ...reviewFileColumns, hunks: reviewFiles.hunks })
    .from(reviewFiles)
    .innerJoin(reviews, eq(reviewFiles.reviewId, reviews.id))
    .where(and(eq(reviewFiles.id, fileId), fileInWorkspace(workspaceId, reviewId)));
  if (!row) return null;
  const { hunks, ...file } = row;
  return { file, hunks };
}
