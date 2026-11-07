import { hasAtLeastRole, type Reviewer, type WorkspaceMember } from '@diffcraft/shared';

export function eligibleReviewers(
  members: readonly WorkspaceMember[],
  reviewers: readonly Pick<Reviewer, 'user'>[],
  authorId: string | null,
): WorkspaceMember[] {
  const assigned = new Set(reviewers.map((r) => r.user.id));
  return members
    .filter(
      (m) => hasAtLeastRole(m.role, 'member') && m.userId !== authorId && !assigned.has(m.userId),
    )
    .sort((a, b) => a.displayName.localeCompare(b.displayName, 'en'));
}
