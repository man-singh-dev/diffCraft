import type { WorkspaceMember, WorkspaceRole } from '@diffcraft/shared';
import { describe, expect, it } from 'vitest';
import { eligibleReviewers } from './eligible-reviewers.js';

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const member = (n: number, displayName: string, role: WorkspaceRole): WorkspaceMember => ({
  userId: uuid(n),
  email: `${displayName.toLowerCase()}@example.com`,
  displayName,
  role,
  joinedAt: '2026-11-01T00:00:00.000Z',
});

describe('eligibleReviewers', () => {
  const members = [
    member(1, 'Zoe', 'owner'),
    member(2, 'Asha', 'member'),
    member(3, 'Vik', 'viewer'),
    member(4, 'Ravi', 'admin'),
    member(5, 'Bo', 'member'),
  ];

  it('keeps members and above, not the author, not already assigned, sorted by name', () => {
    const reviewers = [{ user: { id: uuid(5), displayName: 'Bo' } }];
    expect(eligibleReviewers(members, reviewers, uuid(2)).map((m) => m.displayName)).toEqual([
      'Ravi',
      'Zoe',
    ]);
  });

  it('keeps everyone but viewers when the author is deleted and nobody is assigned', () => {
    expect(eligibleReviewers(members, [], null).map((m) => m.displayName)).toEqual([
      'Asha',
      'Bo',
      'Ravi',
      'Zoe',
    ]);
  });

  it('is empty when everyone is assigned', () => {
    const reviewers = members.map((m) => ({ user: { id: m.userId, displayName: m.displayName } }));
    expect(eligibleReviewers(members, reviewers, null)).toEqual([]);
  });
});
