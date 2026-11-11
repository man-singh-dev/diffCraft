import {
  evaluateReview,
  hasAtLeastRole,
  type ApprovalRules,
  type Decision,
  type Review,
  type ReviewDecision,
  type ReviewEvent,
  type Reviewer,
  type ReviewState,
} from '@diffcraft/shared';
import { and, asc, count, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import {
  commentThreads,
  reviewDecisions,
  reviewEvents,
  reviewReviewers,
  reviews,
  users,
  workspaceMembers,
  workspaces,
} from '../../db/schema/index.js';
import type { Database } from '../../plugins/db.js';
import { authorAndReviewers, notify } from '../notifications/service.js';
import { ReviewMergedError, ReviewNotFoundError } from '../reviews/errors.js';
import { getReview, lockReview, type Tx } from '../reviews/service.js';
import {
  InvalidReviewersError,
  MergeBlockedError,
  NotAReviewerError,
  ReviewNotOpenError,
  type InvalidReviewerReason,
} from './errors.js';

type Executor = Database | Tx;

const rulesColumns = {
  requiredApprovals: workspaces.requiredApprovals,
  requireResolvedThreads: workspaces.requireResolvedThreads,
};

export async function getRules(db: Executor, workspaceId: string): Promise<ApprovalRules | null> {
  const [row] = await db
    .select(rulesColumns)
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId));
  return row ?? null;
}

export async function updateRules(
  db: Database,
  workspaceId: string,
  rules: Partial<ApprovalRules>,
): Promise<ApprovalRules | null> {
  const [row] = await db
    .update(workspaces)
    .set({
      ...(rules.requiredApprovals !== undefined && { requiredApprovals: rules.requiredApprovals }),
      ...(rules.requireResolvedThreads !== undefined && {
        requireResolvedThreads: rules.requireResolvedThreads,
      }),
    })
    .where(eq(workspaces.id, workspaceId))
    .returning(rulesColumns);
  return row ?? null;
}

// One query: DISTINCT ON keeps each current reviewer's newest decision. Starting from
// review_reviewers and joining only decisions since the current assignment is what makes a
// removed (or removed and re-assigned) reviewer's earlier decisions stop counting.
export async function listReviewers(
  db: Executor,
  workspaceId: string,
  reviewId: string,
): Promise<Reviewer[]> {
  const rows = await db
    .selectDistinctOn([reviewReviewers.userId], {
      userId: reviewReviewers.userId,
      displayName: users.displayName,
      assignedAt: reviewReviewers.createdAt,
      decision: reviewDecisions.decision,
      decidedAt: reviewDecisions.createdAt,
    })
    .from(reviewReviewers)
    .innerJoin(
      reviews,
      and(eq(reviews.id, reviewReviewers.reviewId), eq(reviews.workspaceId, workspaceId)),
    )
    .innerJoin(users, eq(users.id, reviewReviewers.userId))
    .leftJoin(
      reviewDecisions,
      and(
        eq(reviewDecisions.reviewId, reviewReviewers.reviewId),
        eq(reviewDecisions.reviewerId, reviewReviewers.userId),
        gte(reviewDecisions.createdAt, reviewReviewers.createdAt),
      ),
    )
    .where(eq(reviewReviewers.reviewId, reviewId))
    .orderBy(
      reviewReviewers.userId,
      sql`${reviewDecisions.createdAt} desc nulls last`,
      desc(reviewDecisions.id),
    );

  return rows
    .sort(
      (a, b) => a.assignedAt.getTime() - b.assignedAt.getTime() || (a.userId < b.userId ? -1 : 1),
    )
    .map((row) => ({
      user: { id: row.userId, displayName: row.displayName },
      latestDecision: row.decision,
      decidedAt: row.decidedAt?.toISOString() ?? null,
    }));
}

export async function isReviewer(
  db: Executor,
  workspaceId: string,
  reviewId: string,
  userId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ userId: reviewReviewers.userId })
    .from(reviewReviewers)
    .innerJoin(
      reviews,
      and(eq(reviews.id, reviewReviewers.reviewId), eq(reviews.workspaceId, workspaceId)),
    )
    .where(and(eq(reviewReviewers.reviewId, reviewId), eq(reviewReviewers.userId, userId)));
  return row !== undefined;
}

async function countOpenThreads(db: Executor, reviewId: string): Promise<number> {
  const [row] = await db
    .select({ open: count() })
    .from(commentThreads)
    .where(and(eq(commentThreads.reviewId, reviewId), eq(commentThreads.status, 'open')));
  return row?.open ?? 0;
}

async function computeState(
  db: Executor,
  workspaceId: string,
  reviewId: string,
): Promise<ReviewState | null> {
  const [review] = await db
    .select({ status: reviews.status, ...rulesColumns })
    .from(reviews)
    .innerJoin(workspaces, eq(workspaces.id, reviews.workspaceId))
    .where(and(eq(reviews.id, reviewId), eq(reviews.workspaceId, workspaceId)));
  if (!review) return null;

  const { status, ...rules } = review;
  const [latestDecisions, openThreads] = await Promise.all([
    listReviewers(db, workspaceId, reviewId),
    countOpenThreads(db, reviewId),
  ]);
  return evaluateReview({ status, latestDecisions, openThreads, rules });
}

export async function getReviewState(
  db: Database,
  workspaceId: string,
  reviewId: string,
): Promise<ReviewState | null> {
  return computeState(db, workspaceId, reviewId);
}

// Not now() (transaction start): a transaction that waited on the review lock must still be dated after what it waited for.
const assignedOrDecidedAt = sql<Date>`clock_timestamp()`;

async function lockChangeableReview(tx: Tx, workspaceId: string, reviewId: string) {
  const review = await lockReview(tx, workspaceId, reviewId);
  if (!review) throw new ReviewNotFoundError();
  if (review.status === 'merged') throw new ReviewMergedError();
  return review;
}

export async function assignReviewers(
  db: Database,
  {
    workspaceId,
    reviewId,
    actorId,
    userIds,
  }: { workspaceId: string; reviewId: string; actorId: string; userIds: string[] },
): Promise<Reviewer[]> {
  return db.transaction(async (tx) => {
    const review = await lockChangeableReview(tx, workspaceId, reviewId);

    const members = await tx
      .select({ userId: workspaceMembers.userId, role: workspaceMembers.role })
      .from(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, workspaceId),
          inArray(workspaceMembers.userId, userIds),
        ),
      );
    const roles = new Map(members.map((m) => [m.userId, m.role]));
    const invalid: { userId: string; reason: InvalidReviewerReason }[] = [];
    for (const userId of userIds) {
      const role = roles.get(userId);
      if (role === undefined) invalid.push({ userId, reason: 'not_a_member' });
      else if (!hasAtLeastRole(role, 'member')) invalid.push({ userId, reason: 'viewer' });
      else if (userId === review.authorId) invalid.push({ userId, reason: 'author' });
    }
    if (invalid.length > 0) throw new InvalidReviewersError(invalid);

    const added = await tx
      .insert(reviewReviewers)
      .values(
        userIds.map((userId) => ({
          reviewId: review.id,
          userId,
          assignedBy: actorId,
          createdAt: assignedOrDecidedAt,
        })),
      )
      .onConflictDoNothing()
      .returning({ userId: reviewReviewers.userId });

    if (added.length > 0) {
      await tx.insert(reviewEvents).values(
        added.map(({ userId }) => ({
          reviewId: review.id,
          actorId,
          type: 'reviewer_assigned' as const,
          data: { userId },
        })),
      );
      await notify(tx, {
        workspaceId,
        reviewId: review.id,
        actorId,
        type: 'reviewer_assigned',
        recipients: added.map(({ userId }) => userId),
      });
    }
    return listReviewers(tx, workspaceId, review.id);
  });
}

export async function removeReviewer(
  db: Database,
  {
    workspaceId,
    reviewId,
    actorId,
    userId,
  }: { workspaceId: string; reviewId: string; actorId: string; userId: string },
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const review = await lockChangeableReview(tx, workspaceId, reviewId);
    const removed = await tx
      .delete(reviewReviewers)
      .where(and(eq(reviewReviewers.reviewId, review.id), eq(reviewReviewers.userId, userId)))
      .returning({ userId: reviewReviewers.userId });
    if (removed.length === 0) return false;

    await tx
      .insert(reviewEvents)
      .values({ reviewId: review.id, actorId, type: 'reviewer_removed', data: { userId } });
    return true;
  });
}

export async function submitDecision(
  db: Database,
  {
    workspaceId,
    reviewId,
    reviewerId,
    decision,
    body,
  }: {
    workspaceId: string;
    reviewId: string;
    reviewerId: string;
    decision: Decision;
    body?: string | undefined;
  },
): Promise<ReviewDecision> {
  return db.transaction(async (tx) => {
    // The lock orders this against a concurrent merge: whichever runs second sees the other's result.
    const review = await lockReview(tx, workspaceId, reviewId);
    if (!review) throw new ReviewNotFoundError();
    if (review.status !== 'open') throw new ReviewNotOpenError();

    const [reviewer] = await tx
      .select({ displayName: users.displayName })
      .from(reviewReviewers)
      .innerJoin(users, eq(users.id, reviewReviewers.userId))
      .where(and(eq(reviewReviewers.reviewId, review.id), eq(reviewReviewers.userId, reviewerId)));
    if (!reviewer) throw new NotAReviewerError();

    const [row] = await tx
      .insert(reviewDecisions)
      .values({
        reviewId: review.id,
        reviewerId,
        decision,
        body: body ?? null,
        createdAt: assignedOrDecidedAt,
      })
      .returning();
    if (!row) throw new Error('INSERT ... RETURNING returned no row');

    await tx.insert(reviewEvents).values({
      reviewId: review.id,
      actorId: reviewerId,
      type: 'decision',
      data: { decisionId: row.id, decision },
    });
    await notify(tx, {
      workspaceId,
      reviewId: review.id,
      actorId: reviewerId,
      type: decision === 'approve' ? 'review_approved' : 'changes_requested',
      recipients: [review.authorId],
    });

    return {
      id: row.id,
      reviewId: row.reviewId,
      reviewer: { id: reviewerId, displayName: reviewer.displayName },
      decision: row.decision,
      body: row.body,
      createdAt: row.createdAt.toISOString(),
    };
  });
}

export async function listDecisions(
  db: Database,
  workspaceId: string,
  reviewId: string,
): Promise<ReviewDecision[]> {
  const rows = await db
    .select({ decision: reviewDecisions, reviewerName: users.displayName })
    .from(reviewDecisions)
    .innerJoin(
      reviews,
      and(eq(reviews.id, reviewDecisions.reviewId), eq(reviews.workspaceId, workspaceId)),
    )
    .leftJoin(users, eq(users.id, reviewDecisions.reviewerId))
    .where(eq(reviewDecisions.reviewId, reviewId))
    .orderBy(asc(reviewDecisions.createdAt), asc(reviewDecisions.id));

  return rows.map(({ decision, reviewerName }) => ({
    id: decision.id,
    reviewId: decision.reviewId,
    reviewer:
      decision.reviewerId !== null && reviewerName !== null
        ? { id: decision.reviewerId, displayName: reviewerName }
        : null,
    decision: decision.decision,
    body: decision.body,
    createdAt: decision.createdAt.toISOString(),
  }));
}

export async function listEvents(
  db: Database,
  workspaceId: string,
  reviewId: string,
): Promise<ReviewEvent[]> {
  const rows = await db
    .select({ event: reviewEvents, actorName: users.displayName })
    .from(reviewEvents)
    .innerJoin(
      reviews,
      and(eq(reviews.id, reviewEvents.reviewId), eq(reviews.workspaceId, workspaceId)),
    )
    .leftJoin(users, eq(users.id, reviewEvents.actorId))
    .where(eq(reviewEvents.reviewId, reviewId))
    .orderBy(asc(reviewEvents.createdAt), asc(reviewEvents.id));

  return rows.map(({ event, actorName }) => ({
    id: event.id,
    reviewId: event.reviewId,
    actor:
      event.actorId !== null && actorName !== null
        ? { id: event.actorId, displayName: actorName }
        : null,
    type: event.type,
    data: event.data,
    createdAt: event.createdAt.toISOString(),
  }));
}

export async function mergeReview(
  db: Database,
  { workspaceId, reviewId, actorId }: { workspaceId: string; reviewId: string; actorId: string },
): Promise<Review> {
  return db.transaction(async (tx) => {
    // Lock first, then read: a state computed before the lock could miss a decision that commits in between.
    const review = await lockReview(tx, workspaceId, reviewId);
    if (!review) throw new ReviewNotFoundError();
    if (review.status === 'merged') throw new ReviewMergedError();

    const state = await computeState(tx, workspaceId, review.id);
    if (!state) throw new ReviewNotFoundError();
    if (!state.canMerge) throw new MergeBlockedError(state.reasons);

    await tx
      .update(reviews)
      .set({ status: 'merged', mergedBy: actorId, mergedAt: sql`now()` })
      .where(eq(reviews.id, review.id));
    await tx.insert(reviewEvents).values({ reviewId: review.id, actorId, type: 'merged' });
    await notify(tx, {
      workspaceId,
      reviewId: review.id,
      actorId,
      type: 'review_merged',
      recipients: await authorAndReviewers(tx, review.id),
    });

    const merged = await getReview(tx, workspaceId, review.id);
    if (!merged) throw new Error('review not found after merge');
    return merged;
  });
}
