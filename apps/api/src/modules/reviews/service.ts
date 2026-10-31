import {
  parsePatch,
  type CreateReviewRequest,
  type DiffHunk,
  type Review,
  type ReviewFile,
} from '@diffcraft/shared';
import { and, asc, eq, sql } from 'drizzle-orm';
import { reviewFiles, reviews, users, workspaces, type ReviewRow } from '../../db/schema/index.js';
import type { Database } from '../../plugins/db.js';
import { WorkspaceNotFoundError } from '../workspaces/require-workspace-role.js';

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

/**
 * Parses the patch and stores the review with its files. `input` must already be validated.
 * Throws DiffParseError for a patch the parser rejects, before anything is written.
 */
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

    // One statement for all files: 300 files (the parser's limit) × 9 values stays far below
    // Postgres's 65,535 bind parameters.
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

/** Increments the workspace's counter; the UPDATE's row lock serialises concurrent creates. */
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

/** Matches both ids, so a review can't be read through a workspace it isn't in. */
export async function getReview(
  db: Database,
  workspaceId: string,
  reviewId: string,
): Promise<Review | null> {
  const [result] = await db
    .select({ review: reviews, authorId: users.id, authorName: users.displayName })
    .from(reviews)
    .leftJoin(users, eq(reviews.authorId, users.id))
    .where(and(eq(reviews.id, reviewId), eq(reviews.workspaceId, workspaceId)));
  if (!result) return null;
  const { review, authorId, authorName } = result;
  return toReview(
    review,
    authorId !== null && authorName !== null ? { id: authorId, displayName: authorName } : null,
  );
}

/** The review's files in patch order, without their hunks. */
export async function listReviewFiles(db: Database, reviewId: string): Promise<ReviewFile[]> {
  return db
    .select({
      id: reviewFiles.id,
      position: reviewFiles.position,
      oldPath: reviewFiles.oldPath,
      newPath: reviewFiles.newPath,
      changeType: reviewFiles.changeType,
      isBinary: reviewFiles.isBinary,
      additions: reviewFiles.additions,
      deletions: reviewFiles.deletions,
    })
    .from(reviewFiles)
    .where(eq(reviewFiles.reviewId, reviewId))
    .orderBy(asc(reviewFiles.position));
}

export async function getReviewFileHunks(
  db: Database,
  reviewId: string,
  fileId: string,
): Promise<DiffHunk[] | null> {
  const [row] = await db
    .select({ hunks: reviewFiles.hunks })
    .from(reviewFiles)
    .where(and(eq(reviewFiles.id, fileId), eq(reviewFiles.reviewId, reviewId)));
  return row?.hunks ?? null;
}
