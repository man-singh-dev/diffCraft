import { describe, expect, it } from 'vitest';
import {
  ApprovalRulesSchema,
  AssignReviewersRequestSchema,
  canAssignReviewers,
  canDecide,
  canMerge,
  canTransition,
  DECISIONS,
  evaluateReview,
  REVIEW_EVENT_TYPES,
  SubmitDecisionRequestSchema,
  UpdateApprovalRulesRequestSchema,
  type Decision,
  type EvaluateReviewInput,
  type ReviewState,
} from './approvals.js';
import { REVIEW_STATUSES, type ReviewStatus } from './reviews.js';
import { WORKSPACE_ROLES, type WorkspaceRole } from './workspaces.js';

const ID_A = '01a17e5e-aa56-7985-be46-bf5f1c7e7fd0';
const ID_B = '01a17e5e-aa56-7985-be46-bf5f1c7e7fd1';

describe('constants', () => {
  it('lists the decisions and event types', () => {
    expect(DECISIONS).toEqual(['approve', 'request_changes']);
    expect(REVIEW_EVENT_TYPES).toEqual([
      'reviewer_assigned',
      'reviewer_removed',
      'decision',
      'closed',
      'reopened',
      'merged',
    ]);
  });
});

describe('ApprovalRulesSchema', () => {
  it.each([0, 1, 10])('accepts %i required approvals', (requiredApprovals) => {
    expect(
      ApprovalRulesSchema.safeParse({ requiredApprovals, requireResolvedThreads: true }).success,
    ).toBe(true);
  });

  it.each([
    { requiredApprovals: -1, requireResolvedThreads: false },
    { requiredApprovals: 11, requireResolvedThreads: false },
    { requiredApprovals: 1.5, requireResolvedThreads: false },
    { requiredApprovals: '1', requireResolvedThreads: false },
    { requiredApprovals: 1, requireResolvedThreads: 'yes' },
    { requiredApprovals: 1 },
  ])('rejects %j', (rules) => {
    expect(ApprovalRulesSchema.safeParse(rules).success).toBe(false);
  });
});

describe('SubmitDecisionRequestSchema', () => {
  it('accepts a decision with or without a trimmed body', () => {
    expect(SubmitDecisionRequestSchema.parse({ decision: 'approve' })).toEqual({
      decision: 'approve',
    });
    expect(
      SubmitDecisionRequestSchema.parse({ decision: 'request_changes', body: '  Fix it  ' }),
    ).toEqual({ decision: 'request_changes', body: 'Fix it' });
  });

  it.each([
    { decision: 'approved' },
    { decision: 'approve', body: '' },
    { decision: 'approve', body: 'x'.repeat(10_001) },
    { decision: 'approve', body: 'a\0b' },
    { body: 'Looks good' },
  ])('rejects %j', (body) => {
    expect(SubmitDecisionRequestSchema.safeParse(body).success).toBe(false);
  });
});

describe('AssignReviewersRequestSchema', () => {
  it('accepts 1 to 10 distinct uuids', () => {
    expect(AssignReviewersRequestSchema.parse({ userIds: [ID_A, ID_B] })).toEqual({
      userIds: [ID_A, ID_B],
    });
    const ten = Array.from(
      { length: 10 },
      (_, i) => `01a17e5e-aa56-7985-be46-bf5f1c7e7f${String(i).padStart(2, '0')}`,
    );
    expect(AssignReviewersRequestSchema.safeParse({ userIds: ten }).success).toBe(true);
  });

  it.each([
    ['no users', []],
    ['11 users', Array.from({ length: 11 }, (_, i) => `${ID_A.slice(0, -2)}${10 + i}`)],
    ['a duplicate', [ID_A, ID_A]],
    ['a non-uuid', ['someone']],
  ])('rejects %s', (_, userIds) => {
    expect(AssignReviewersRequestSchema.safeParse({ userIds }).success).toBe(false);
  });
});

const reviewer = (displayName: string, latestDecision: Decision | null) => ({
  user: { id: `${displayName}-id`, displayName },
  latestDecision,
});

const input = (overrides: Partial<EvaluateReviewInput> = {}): EvaluateReviewInput => ({
  status: 'open',
  latestDecisions: [],
  openThreads: 0,
  rules: { requiredApprovals: 1, requireResolvedThreads: false },
  ...overrides,
});

describe('evaluateReview', () => {
  const cases: [string, Partial<EvaluateReviewInput>, Partial<ReviewState>][] = [
    [
      '0 required, no decisions: mergeable but still pending',
      { rules: { requiredApprovals: 0, requireResolvedThreads: false } },
      { state: 'pending', approvals: 0, requiredApprovals: 0, canMerge: true, reasons: [] },
    ],
    [
      '0 required, one approval: approved',
      {
        rules: { requiredApprovals: 0, requireResolvedThreads: false },
        latestDecisions: [reviewer('Ada', 'approve')],
      },
      { state: 'approved', approvals: 1, canMerge: true, reasons: [] },
    ],
    [
      '1 required, none given',
      { latestDecisions: [reviewer('Ada', null)] },
      { state: 'pending', approvals: 0, canMerge: false, reasons: ['0 of 1 required approval'] },
    ],
    [
      '1 required, one approval',
      { latestDecisions: [reviewer('Ada', 'approve'), reviewer('Bo', null)] },
      { state: 'approved', approvals: 1, canMerge: true, reasons: [] },
    ],
    [
      '2 required, one approval',
      {
        rules: { requiredApprovals: 2, requireResolvedThreads: false },
        latestDecisions: [reviewer('Ada', 'approve')],
      },
      { state: 'pending', approvals: 1, canMerge: false, reasons: ['1 of 2 required approvals'] },
    ],
    [
      '2 required, two approvals',
      {
        rules: { requiredApprovals: 2, requireResolvedThreads: false },
        latestDecisions: [reviewer('Ada', 'approve'), reviewer('Bo', 'approve')],
      },
      { state: 'approved', approvals: 2, canMerge: true },
    ],
    [
      'request changes blocks even with enough approvals',
      {
        latestDecisions: [reviewer('Ada', 'approve'), reviewer('Ravi', 'request_changes')],
      },
      {
        state: 'changes_requested',
        approvals: 1,
        canMerge: false,
        reasons: ['Ravi requested changes'],
      },
    ],
    [
      'request changes blocks with 0 required',
      {
        rules: { requiredApprovals: 0, requireResolvedThreads: false },
        latestDecisions: [reviewer('Ravi', 'request_changes')],
      },
      { state: 'changes_requested', canMerge: false, reasons: ['Ravi requested changes'] },
    ],
    [
      'unresolved threads block only when the rule is on',
      {
        rules: { requiredApprovals: 1, requireResolvedThreads: true },
        latestDecisions: [reviewer('Ada', 'approve')],
        openThreads: 2,
      },
      { state: 'approved', openThreads: 2, canMerge: false, reasons: ['2 unresolved threads'] },
    ],
    [
      'one unresolved thread, singular',
      {
        rules: { requiredApprovals: 0, requireResolvedThreads: true },
        openThreads: 1,
      },
      { canMerge: false, reasons: ['1 unresolved thread'] },
    ],
    [
      'unresolved threads are ignored when the rule is off',
      { latestDecisions: [reviewer('Ada', 'approve')], openThreads: 5 },
      { openThreads: 5, canMerge: true, reasons: [] },
    ],
    [
      'a closed review cannot merge',
      { status: 'closed', latestDecisions: [reviewer('Ada', 'approve')] },
      { state: 'approved', canMerge: false, reasons: ['The review is closed'] },
    ],
    [
      'a merged review cannot merge again',
      { status: 'merged', latestDecisions: [reviewer('Ada', 'approve')] },
      { canMerge: false, reasons: ['The review is already merged'] },
    ],
    [
      'every failing rule is explained, in order',
      {
        status: 'closed',
        rules: { requiredApprovals: 3, requireResolvedThreads: true },
        latestDecisions: [
          reviewer('Ravi', 'request_changes'),
          reviewer('Mei', 'request_changes'),
          reviewer('Ada', 'approve'),
        ],
        openThreads: 3,
      },
      {
        state: 'changes_requested',
        approvals: 1,
        canMerge: false,
        reasons: [
          'The review is closed',
          'Ravi requested changes',
          'Mei requested changes',
          '1 of 3 required approvals',
          '3 unresolved threads',
        ],
      },
    ],
  ];

  it.each(cases)('%s', (_, overrides, expected) => {
    expect(evaluateReview(input(overrides))).toMatchObject(expected);
  });
});

describe('canTransition', () => {
  const allowed = new Set(['open>closed', 'closed>open', 'open>merged']);

  for (const from of REVIEW_STATUSES) {
    for (const to of REVIEW_STATUSES) {
      const expected = allowed.has(`${from}>${to}`);
      it(`${from} → ${to}: ${expected ? 'allowed' : 'refused'}`, () => {
        expect(canTransition(from, to)).toBe(expected);
      });
    }
  }
});

describe('permissions', () => {
  const AUTHOR = ID_A;
  const OTHER = ID_B;
  const review = (status: ReviewStatus = 'open') => ({
    author: { id: AUTHOR, displayName: 'Ada' },
    status,
  });

  const byRole = (expected: Record<WorkspaceRole, boolean>) =>
    WORKSPACE_ROLES.map((role) => [role, expected[role]] as const);

  describe.each([
    ['canAssignReviewers', canAssignReviewers],
    ['canMerge', canMerge],
  ])('%s', (_, check) => {
    it.each(byRole({ owner: true, admin: true, member: true, viewer: false }))(
      'the author as %s: %s',
      (role, expected) => {
        expect(check(role, AUTHOR, AUTHOR)).toBe(expected);
      },
    );

    it.each(byRole({ owner: true, admin: true, member: false, viewer: false }))(
      'someone else as %s: %s',
      (role, expected) => {
        expect(check(role, OTHER, AUTHOR)).toBe(expected);
      },
    );

    it('a review whose author was deleted: admins only', () => {
      expect(check('member', OTHER, null)).toBe(false);
      expect(check('admin', OTHER, null)).toBe(true);
    });
  });

  describe('canDecide', () => {
    it.each(byRole({ owner: true, admin: true, member: true, viewer: false }))(
      'an assigned reviewer as %s: %s',
      (role, expected) => {
        expect(canDecide(role, OTHER, review(), true)).toBe(expected);
      },
    );

    it('refuses someone who is not assigned, even an owner', () => {
      expect(canDecide('owner', OTHER, review(), false)).toBe(false);
    });

    it('refuses the author, even if assigned', () => {
      expect(canDecide('owner', AUTHOR, review(), true)).toBe(false);
    });

    it.each(['closed', 'merged'] as const)('refuses on a %s review', (status) => {
      expect(canDecide('member', OTHER, review(status), true)).toBe(false);
    });

    it('allows deciding on a review whose author was deleted', () => {
      expect(canDecide('member', OTHER, { author: null, status: 'open' }, true)).toBe(true);
    });
  });
});

describe('UpdateApprovalRulesRequestSchema', () => {
  it('accepts either field alone or both', () => {
    expect(UpdateApprovalRulesRequestSchema.parse({ requiredApprovals: 0 })).toEqual({
      requiredApprovals: 0,
    });
    expect(UpdateApprovalRulesRequestSchema.parse({ requireResolvedThreads: false })).toEqual({
      requireResolvedThreads: false,
    });
    expect(
      UpdateApprovalRulesRequestSchema.parse({
        requiredApprovals: 10,
        requireResolvedThreads: true,
      }),
    ).toEqual({ requiredApprovals: 10, requireResolvedThreads: true });
  });

  it.each([
    {},
    { requiredApprovals: 11 },
    { requiredApprovals: -1 },
    { requiredApprovals: 2.5 },
    { requiredApprovals: '2' },
    { requireResolvedThreads: 'true' },
    { requiredApprovals: null },
  ])('rejects %j', (body) => {
    expect(UpdateApprovalRulesRequestSchema.safeParse(body).success).toBe(false);
  });
});
