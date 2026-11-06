import { z } from 'zod';
import { CommentBodySchema } from './comments.ts';
import type { Review, ReviewStatus } from './reviews.ts';
import { hasAtLeastRole, type WorkspaceRole } from './workspaces.ts';

export const DECISIONS = ['approve', 'request_changes'] as const;
export const DecisionSchema = z.enum(DECISIONS);
export type Decision = z.infer<typeof DecisionSchema>;

export const REVIEW_EVENT_TYPES = [
  'reviewer_assigned',
  'reviewer_removed',
  'decision',
  'closed',
  'reopened',
  'merged',
] as const;
export const ReviewEventTypeSchema = z.enum(REVIEW_EVENT_TYPES);
export type ReviewEventType = z.infer<typeof ReviewEventTypeSchema>;

export const MAX_REQUIRED_APPROVALS = 10;

export const ApprovalRulesSchema = z.object({
  requiredApprovals: z.number().int().min(0).max(MAX_REQUIRED_APPROVALS),
  requireResolvedThreads: z.boolean(),
});
export type ApprovalRules = z.infer<typeof ApprovalRulesSchema>;

export const SubmitDecisionRequestSchema = z.object({
  decision: DecisionSchema,
  body: CommentBodySchema.optional(),
});
export type SubmitDecisionRequest = z.infer<typeof SubmitDecisionRequestSchema>;

export const AssignReviewersRequestSchema = z.object({
  userIds: z
    .array(z.uuid())
    .min(1)
    .max(10)
    .refine((ids) => new Set(ids).size === ids.length, 'Each user can be listed only once.'),
});
export type AssignReviewersRequest = z.infer<typeof AssignReviewersRequestSchema>;

const UserRefSchema = z.object({ id: z.uuid(), displayName: z.string() });

export const ReviewDecisionSchema = z.object({
  id: z.uuid(),
  reviewId: z.uuid(),
  reviewer: UserRefSchema.nullable(),
  decision: DecisionSchema,
  body: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
export type ReviewDecision = z.infer<typeof ReviewDecisionSchema>;

export const ReviewEventSchema = z.object({
  id: z.uuid(),
  reviewId: z.uuid(),
  actor: UserRefSchema.nullable(),
  type: ReviewEventTypeSchema,
  data: z.record(z.string(), z.unknown()),
  createdAt: z.iso.datetime(),
});
export type ReviewEvent = z.infer<typeof ReviewEventSchema>;

export const ReviewerSchema = z.object({
  user: UserRefSchema,
  latestDecision: DecisionSchema.nullable(),
  decidedAt: z.iso.datetime().nullable(),
});
export type Reviewer = z.infer<typeof ReviewerSchema>;

export const REVIEW_STATES = ['pending', 'approved', 'changes_requested'] as const;

export const ReviewStateSchema = z.object({
  state: z.enum(REVIEW_STATES),
  approvals: z.number().int().nonnegative(),
  requiredApprovals: z.number().int().nonnegative(),
  openThreads: z.number().int().nonnegative(),
  canMerge: z.boolean(),
  reasons: z.array(z.string()),
});
export type ReviewState = z.infer<typeof ReviewStateSchema>;

export interface EvaluateReviewInput {
  status: ReviewStatus;
  /** One entry per current reviewer; decisions of former reviewers must not be passed. */
  latestDecisions: readonly Pick<Reviewer, 'user' | 'latestDecision'>[];
  openThreads: number;
  rules: ApprovalRules;
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

export function evaluateReview({
  status,
  latestDecisions,
  openThreads,
  rules,
}: EvaluateReviewInput): ReviewState {
  const approvals = latestDecisions.filter((r) => r.latestDecision === 'approve').length;
  const blockers = latestDecisions.filter((r) => r.latestDecision === 'request_changes');
  const { requiredApprovals, requireResolvedThreads } = rules;

  const reasons: string[] = [];
  if (status !== 'open') {
    reasons.push(status === 'merged' ? 'The review is already merged' : 'The review is closed');
  }
  for (const blocker of blockers) reasons.push(`${blocker.user.displayName} requested changes`);
  if (approvals < requiredApprovals) {
    reasons.push(
      `${approvals} of ${requiredApprovals} required approval${requiredApprovals === 1 ? '' : 's'}`,
    );
  }
  if (requireResolvedThreads && openThreads > 0) {
    reasons.push(plural(openThreads, 'unresolved thread'));
  }

  // With no approvals required a review can merge, but it only counts as approved once someone approves.
  const state =
    blockers.length > 0
      ? 'changes_requested'
      : approvals >= Math.max(requiredApprovals, 1)
        ? 'approved'
        : 'pending';

  return {
    state,
    approvals,
    requiredApprovals,
    openThreads,
    canMerge: reasons.length === 0,
    reasons,
  };
}

const REVIEW_TRANSITIONS: Record<ReviewStatus, readonly ReviewStatus[]> = {
  open: ['closed', 'merged'],
  closed: ['open'],
  merged: [],
};

export function canTransition(from: ReviewStatus, to: ReviewStatus): boolean {
  return REVIEW_TRANSITIONS[from].includes(to);
}

function isAuthorOrAdmin(role: WorkspaceRole, userId: string, reviewAuthorId: string | null) {
  if (hasAtLeastRole(role, 'admin')) return true;
  return hasAtLeastRole(role, 'member') && reviewAuthorId === userId;
}

export function canAssignReviewers(
  role: WorkspaceRole,
  userId: string,
  reviewAuthorId: string | null,
): boolean {
  return isAuthorOrAdmin(role, userId, reviewAuthorId);
}

export function canDecide(
  role: WorkspaceRole,
  userId: string,
  review: Pick<Review, 'author' | 'status'>,
  isAssignedReviewer: boolean,
): boolean {
  return (
    hasAtLeastRole(role, 'member') &&
    isAssignedReviewer &&
    review.author?.id !== userId &&
    review.status === 'open'
  );
}

/** Only who may merge; whether the review's rules allow it is evaluateReview's job. */
export function canMerge(
  role: WorkspaceRole,
  userId: string,
  reviewAuthorId: string | null,
): boolean {
  return isAuthorOrAdmin(role, userId, reviewAuthorId);
}
