import { randomUUID } from 'node:crypto';
import {
  ApprovalRulesSchema,
  ErrorResponseSchema,
  InvalidReviewersDetailsSchema,
  MergeBlockedDetailsSchema,
  ReviewDecisionSchema,
  ReviewerSchema,
  ReviewEventSchema,
  ReviewListResponseSchema,
  ReviewSchema,
  ReviewStateSchema,
  WorkspaceSchema,
  type Review,
  type Workspace,
  type WorkspaceRole,
} from '@diffcraft/shared';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';
import { describeWithDb, testDatabaseUrl } from '../../test/db.js';
import { addMember, createUserWithSession, type TestUser } from '../../test/fixtures.js';

const BASE = '/api/v1/workspaces';

const PATCH = `--- a/a.txt
+++ b/a.txt
@@ -1 +1 @@
-old
+new
`;

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';
type Endpoint =
  | 'state'
  | 'reviewers'
  | 'assign'
  | 'unassign'
  | 'decide'
  | 'decisions'
  | 'merge'
  | 'events'
  | 'rules'
  | 'updateRules';
type Caller = 'logged out' | 'non-member' | WorkspaceRole;
type Expected = number | [number, string];

const READ = {
  'logged out': 401,
  'non-member': 404,
  viewer: 200,
  member: 200,
  admin: 200,
  owner: 200,
};

// Review by another member, one assigned reviewer who approved; the caller is never the author or that reviewer.
const MATRIX: Record<Endpoint, Record<Caller, Expected>> = {
  state: READ,
  reviewers: READ,
  assign: {
    'logged out': 401,
    'non-member': 404,
    viewer: 403,
    member: 403,
    admin: 200,
    owner: 200,
  },
  unassign: {
    'logged out': 401,
    'non-member': 404,
    viewer: 403,
    member: 403,
    admin: 204,
    owner: 204,
  },
  decide: {
    'logged out': 401,
    'non-member': 404,
    viewer: 403,
    member: [403, 'not_a_reviewer'],
    admin: [403, 'not_a_reviewer'],
    owner: [403, 'not_a_reviewer'],
  },
  decisions: READ,
  merge: { 'logged out': 401, 'non-member': 404, viewer: 403, member: 403, admin: 200, owner: 200 },
  events: READ,
  rules: READ,
  updateRules: {
    'logged out': 401,
    'non-member': 404,
    viewer: 403,
    member: 403,
    admin: 200,
    owner: 200,
  },
};

const DEFAULT_CODES: Record<number, string> = {
  401: 'unauthenticated',
  403: 'forbidden',
  404: 'workspace_not_found',
};

describeWithDb('approval routes', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp(
      loadConfig({
        LOG_LEVEL: 'silent',
        RATE_LIMIT_ENABLED: 'false',
        NODE_ENV: 'test',
        DATABASE_URL: testDatabaseUrl,
      }),
    );
  });

  afterAll(async () => {
    await app.close();
  });

  const call = (method: Method, url: string, user?: TestUser, payload?: object) =>
    app.inject({
      method,
      url,
      ...(user && { cookies: user.cookies }),
      ...(payload !== undefined && { payload }),
    });

  const errorOf = (res: LightMyRequestResponse) => ErrorResponseSchema.parse(res.json()).error;

  async function createWorkspace(owner: TestUser): Promise<Workspace> {
    const res = await call('POST', BASE, owner, { name: `Team ${randomUUID()}` });
    expect(res.statusCode).toBe(201);
    return WorkspaceSchema.parse(res.json());
  }

  async function memberWithRole(workspaceId: string, role: WorkspaceRole): Promise<TestUser> {
    const user = await createUserWithSession(app.db);
    await addMember(app.db, workspaceId, user.id, role);
    return user;
  }

  async function createReview(workspaceId: string, user: TestUser): Promise<Review> {
    const res = await call('POST', `${BASE}/${workspaceId}/reviews`, user, {
      title: 'Change',
      patch: PATCH,
    });
    expect(res.statusCode).toBe(201);
    return ReviewSchema.parse(res.json());
  }

  const reviewUrl = (workspaceId: string, review: Pick<Review, 'number'>, rest = '') =>
    `${BASE}/${workspaceId}/reviews/${review.number}${rest}`;

  async function setup() {
    const owner = await createUserWithSession(app.db);
    const workspace = await createWorkspace(owner);
    const author = await memberWithRole(workspace.id, 'member');
    const reviewer = await memberWithRole(workspace.id, 'member');
    const review = await createReview(workspace.id, author);
    const url = (rest = '') => reviewUrl(workspace.id, review, rest);
    const assign = (user: TestUser, ...userIds: string[]) =>
      call('POST', url('/reviewers'), user, { userIds });
    const decide = (user: TestUser, decision = 'approve', body?: string) =>
      call('POST', url('/decisions'), user, { decision, ...(body !== undefined && { body }) });
    expect((await assign(author, reviewer.id)).statusCode).toBe(200);
    return { owner, workspace, author, reviewer, review, url, assign, decide };
  }

  describe('authorization matrix', () => {
    const callers: Caller[] = ['logged out', 'non-member', 'viewer', 'member', 'admin', 'owner'];
    const cases = (Object.keys(MATRIX) as Endpoint[]).flatMap((endpoint) =>
      callers.map((caller) => {
        const expected = MATRIX[endpoint][caller];
        const [status, code] = Array.isArray(expected) ? expected : [expected, undefined];
        return { endpoint, caller, status, code: code ?? DEFAULT_CODES[status] };
      }),
    );

    it.each(cases)('$endpoint as $caller → $status', async ({ endpoint, caller, status, code }) => {
      const s = await setup();
      expect((await s.decide(s.reviewer)).statusCode).toBe(201);
      const candidate = await memberWithRole(s.workspace.id, 'member');

      let user: TestUser | undefined;
      if (caller === 'owner') user = s.owner;
      else if (caller === 'non-member') user = await createUserWithSession(app.db);
      else if (caller !== 'logged out') user = await memberWithRole(s.workspace.id, caller);

      const rulesUrl = `${BASE}/${s.workspace.id}/rules`;
      const res = await {
        state: () => call('GET', s.url('/state'), user),
        reviewers: () => call('GET', s.url('/reviewers'), user),
        assign: () => call('POST', s.url('/reviewers'), user, { userIds: [candidate.id] }),
        unassign: () => call('DELETE', s.url(`/reviewers/${s.reviewer.id}`), user),
        decide: () => call('POST', s.url('/decisions'), user, { decision: 'approve' }),
        decisions: () => call('GET', s.url('/decisions'), user),
        merge: () => call('POST', s.url('/merge'), user),
        events: () => call('GET', s.url('/events'), user),
        rules: () => call('GET', rulesUrl, user),
        updateRules: () => call('PATCH', rulesUrl, user, { requiredApprovals: 2 }),
      }[endpoint]();

      expect(res.statusCode).toBe(status);
      if (code !== undefined) expect(errorOf(res).code).toBe(code);
      if (status !== 200) return;
      const body: unknown = res.json();
      ({
        state: () => ReviewStateSchema.parse(body),
        reviewers: () => ReviewerSchema.array().parse(body),
        assign: () => expect(ReviewerSchema.array().parse(body)).toHaveLength(2),
        unassign: () => undefined,
        decide: () => undefined,
        decisions: () => ReviewDecisionSchema.array().parse(body),
        merge: () => expect(ReviewSchema.parse(body).status).toBe('merged'),
        events: () => ReviewEventSchema.array().parse(body),
        rules: () => ApprovalRulesSchema.parse(body),
        updateRules: () => expect(ApprovalRulesSchema.parse(body).requiredApprovals).toBe(2),
      })[endpoint]();
    });
  });

  describe('permissions', () => {
    it('the author assigns and merges; another member can do neither', async () => {
      const s = await setup();
      const other = await memberWithRole(s.workspace.id, 'member');
      const candidate = await memberWithRole(s.workspace.id, 'member');

      const denied = await s.assign(other, candidate.id);
      expect(denied.statusCode).toBe(403);
      expect(errorOf(denied).code).toBe('forbidden');

      const assigned = await s.assign(s.author, candidate.id);
      expect(assigned.statusCode).toBe(200);
      expect(
        ReviewerSchema.array()
          .parse(assigned.json())
          .map((r) => r.user.id),
      ).toEqual([s.reviewer.id, candidate.id]);

      expect((await s.decide(s.reviewer)).statusCode).toBe(201);
      const mergeDenied = await call('POST', s.url('/merge'), other);
      expect(mergeDenied.statusCode).toBe(403);
      expect(errorOf(mergeDenied).code).toBe('forbidden');
      expect((await call('POST', s.url('/merge'), s.author)).statusCode).toBe(200);
    });

    it('the author cannot decide, an assigned reviewer can, an unassigned member is not a reviewer', async () => {
      const s = await setup();
      const other = await memberWithRole(s.workspace.id, 'member');

      const author = await s.decide(s.author);
      expect(author.statusCode).toBe(403);
      expect(errorOf(author).code).toBe('forbidden');

      const unassigned = await s.decide(other);
      expect(unassigned.statusCode).toBe(403);
      expect(errorOf(unassigned).code).toBe('not_a_reviewer');

      const res = await s.decide(s.reviewer, 'request_changes', 'Please rename it');
      expect(res.statusCode).toBe(201);
      expect(ReviewDecisionSchema.parse(res.json())).toMatchObject({
        reviewer: { id: s.reviewer.id },
        decision: 'request_changes',
        body: 'Please rename it',
      });
    });

    it('validates the decision body after the permission checks', async () => {
      const s = await setup();
      const other = await memberWithRole(s.workspace.id, 'member');
      expect(errorOf(await s.decide(other, 'maybe')).code).toBe('not_a_reviewer');

      const invalid = await s.decide(s.reviewer, 'maybe');
      expect(invalid.statusCode).toBe(422);
      expect(errorOf(invalid).code).toBe('validation_error');
    });

    it('a reviewer removes themselves; another member cannot remove them', async () => {
      const s = await setup();
      const other = await memberWithRole(s.workspace.id, 'member');
      const reviewerUrl = s.url(`/reviewers/${s.reviewer.id}`);

      expect((await call('DELETE', reviewerUrl, other)).statusCode).toBe(403);
      const removed = await call('DELETE', reviewerUrl, s.reviewer);
      expect(removed.statusCode).toBe(204);
      expect(removed.body).toBe('');

      const list = await call('GET', s.url('/reviewers'), s.author);
      expect(ReviewerSchema.array().parse(list.json())).toEqual([]);
      const again = await call('DELETE', reviewerUrl, s.reviewer);
      expect(again.statusCode).toBe(404);
      expect(errorOf(again).code).toBe('reviewer_not_found');
    });

    it('refuses invalid reviewers with 422 and the details', async () => {
      const s = await setup();
      const viewer = await memberWithRole(s.workspace.id, 'viewer');
      const outsider = await createUserWithSession(app.db);

      const res = await s.assign(s.author, viewer.id, outsider.id, s.author.id);
      expect(res.statusCode).toBe(422);
      const error = errorOf(res);
      expect(error.code).toBe('invalid_reviewers');
      expect(InvalidReviewersDetailsSchema.parse(error.details)).toEqual([
        { userId: viewer.id, reason: 'viewer' },
        { userId: outsider.id, reason: 'not_a_member' },
        { userId: s.author.id, reason: 'author' },
      ]);

      for (const payload of [{}, { userIds: [] }, { userIds: ['nope'] }]) {
        const invalid = await call('POST', s.url('/reviewers'), s.author, payload);
        expect(invalid.statusCode).toBe(422);
        expect(errorOf(invalid).code).toBe('validation_error');
      }
      const list = await call('GET', s.url('/reviewers'), s.author);
      expect(ReviewerSchema.array().parse(list.json())).toHaveLength(1);
    });

    it('only admins and owners change the rules, partially and within the limits', async () => {
      const s = await setup();
      const admin = await memberWithRole(s.workspace.id, 'admin');
      const rulesUrl = `${BASE}/${s.workspace.id}/rules`;

      const partial = await call('PATCH', rulesUrl, admin, { requireResolvedThreads: true });
      expect(partial.statusCode).toBe(200);
      expect(ApprovalRulesSchema.parse(partial.json())).toEqual({
        requiredApprovals: 1,
        requireResolvedThreads: true,
      });

      for (const payload of [
        {},
        { requiredApprovals: 11 },
        { requiredApprovals: -1 },
        { requiredApprovals: 1.5 },
        { requireResolvedThreads: 'yes' },
      ]) {
        const res = await call('PATCH', rulesUrl, admin, payload);
        expect(res.statusCode).toBe(422);
        expect(errorOf(res).code).toBe('validation_error');
      }
      const forbidden = await call('PATCH', rulesUrl, s.author, {});
      expect(forbidden.statusCode).toBe(403);

      const rules = await call('GET', rulesUrl, s.reviewer);
      expect(ApprovalRulesSchema.parse(rules.json())).toEqual({
        requiredApprovals: 1,
        requireResolvedThreads: true,
      });
    });
  });

  describe('merge', () => {
    it('is blocked with the reasons and changes nothing, then merges once', async () => {
      const s = await setup();
      const eventsBefore = await call('GET', s.url('/events'), s.author);

      const blocked = await call('POST', s.url('/merge'), s.author);
      expect(blocked.statusCode).toBe(409);
      const error = errorOf(blocked);
      expect(error.code).toBe('merge_blocked');
      expect(MergeBlockedDetailsSchema.parse(error.details)).toEqual({
        reasons: ['0 of 1 required approval'],
      });
      expect(ReviewSchema.parse((await call('GET', s.url(), s.author)).json()).status).toBe('open');
      expect((await call('GET', s.url('/events'), s.author)).json()).toEqual(eventsBefore.json());

      expect((await s.decide(s.reviewer)).statusCode).toBe(201);
      const state = await call('GET', s.url('/state'), s.author);
      expect(ReviewStateSchema.parse(state.json())).toMatchObject({
        state: 'approved',
        canMerge: true,
      });

      const merged = await call('POST', s.url('/merge'), s.author);
      expect(merged.statusCode).toBe(200);
      expect(ReviewSchema.parse(merged.json())).toMatchObject({
        id: s.review.id,
        status: 'merged',
      });

      const twice = await call('POST', s.url('/merge'), s.author);
      expect(twice.statusCode).toBe(409);
      expect(errorOf(twice).code).toBe('review_merged');

      const late = await s.decide(s.reviewer, 'request_changes');
      expect(late.statusCode).toBe(409);
      expect(errorOf(late).code).toBe('review_not_open');

      const events = ReviewEventSchema.array().parse(
        (await call('GET', s.url('/events'), s.author)).json(),
      );
      expect(events.map((e) => e.type)).toEqual(['reviewer_assigned', 'decision', 'merged']);
    });

    it('lists blocking reasons for a request for changes and refuses decisions on a closed review', async () => {
      const s = await setup();
      expect((await s.decide(s.reviewer, 'request_changes')).statusCode).toBe(201);
      const blocked = await call('POST', s.url('/merge'), s.author);
      expect(MergeBlockedDetailsSchema.parse(errorOf(blocked).details).reasons).toEqual([
        'Test requested changes',
        '0 of 1 required approval',
      ]);

      expect((await call('PATCH', s.url(), s.author, { status: 'closed' })).statusCode).toBe(200);
      const closed = await s.decide(s.reviewer);
      expect(closed.statusCode).toBe(409);
      expect(errorOf(closed).code).toBe('review_not_open');
    });

    it('a re-assigned reviewer has to approve again', async () => {
      const s = await setup();
      expect((await s.decide(s.reviewer)).statusCode).toBe(201);
      expect(
        (await call('DELETE', s.url(`/reviewers/${s.reviewer.id}`), s.author)).statusCode,
      ).toBe(204);
      expect((await s.assign(s.author, s.reviewer.id)).statusCode).toBe(200);

      const state = ReviewStateSchema.parse((await call('GET', s.url('/state'), s.author)).json());
      expect(state).toMatchObject({ state: 'pending', approvals: 0, canMerge: false });
      expect((await call('POST', s.url('/merge'), s.author)).statusCode).toBe(409);

      expect((await s.decide(s.reviewer)).statusCode).toBe(201);
      expect((await call('POST', s.url('/merge'), s.author)).statusCode).toBe(200);

      const decisions = ReviewDecisionSchema.array().parse(
        (await call('GET', s.url('/decisions'), s.author)).json(),
      );
      expect(decisions).toHaveLength(2);
      expect(decisions[0]!.createdAt <= decisions[1]!.createdAt).toBe(true);
    });
  });

  describe('reviewer=me', () => {
    it('lists only reviews the caller reviews, with pagination and the status filter', async () => {
      const s = await setup();
      const reviews = [s.review];
      for (let i = 0; i < 3; i++) {
        const review = await createReview(s.workspace.id, s.author);
        reviews.push(review);
        await call('POST', reviewUrl(s.workspace.id, review, '/reviewers'), s.author, {
          userIds: [s.reviewer.id],
        });
      }
      await createReview(s.workspace.id, s.author);
      const closed = reviews[1]!;
      expect(
        (
          await call('PATCH', reviewUrl(s.workspace.id, closed), s.author, {
            status: 'closed',
          })
        ).statusCode,
      ).toBe(200);
      const listUrl = (query: string) => `${BASE}/${s.workspace.id}/reviews?${query}`;
      const list = async (query: string, user = s.reviewer) => {
        const res = await call('GET', listUrl(query), user);
        expect(res.statusCode).toBe(200);
        return ReviewListResponseSchema.parse(res.json());
      };
      const newestFirst = reviews.map((r) => r.id).reverse();

      const first = await list('reviewer=me&limit=3');
      expect(first.items.map((r) => r.id)).toEqual(newestFirst.slice(0, 3));
      expect(first.nextCursor).not.toBeNull();
      const second = await list(
        `reviewer=me&limit=3&cursor=${encodeURIComponent(first.nextCursor!)}`,
      );
      expect(second.items.map((r) => r.id)).toEqual(newestFirst.slice(3));
      expect(second.nextCursor).toBeNull();

      const open = await list('reviewer=me&status=open');
      expect(open.items.map((r) => r.id)).toEqual(newestFirst.filter((id) => id !== closed.id));
      const onlyClosed = await list('reviewer=me&status=closed');
      expect(onlyClosed.items.map((r) => r.id)).toEqual([closed.id]);

      expect((await list('reviewer=me', s.author)).items).toEqual([]);
      const invalid = await call('GET', listUrl(`reviewer=${s.reviewer.id}`), s.reviewer);
      expect(invalid.statusCode).toBe(422);
    });
  });

  describe('isolation', () => {
    it('a review of another workspace is not found, even for a member of both', async () => {
      const s = await setup();
      await createReview(s.workspace.id, s.author);
      const second = await createWorkspace(s.owner);
      const secondReview = await createReview(second.id, s.owner);
      const onlyInFirst = { number: secondReview.number + 1 };

      for (const rest of ['/state', '/reviewers', '/decisions', '/events']) {
        const res = await call('GET', reviewUrl(second.id, onlyInFirst, rest), s.owner);
        expect(res.statusCode).toBe(404);
        expect(errorOf(res).code).toBe('review_not_found');
      }
      for (const [method, rest, payload] of [
        ['POST', '/reviewers', { userIds: [s.reviewer.id] }],
        ['DELETE', `/reviewers/${s.reviewer.id}`, undefined],
        ['POST', '/decisions', { decision: 'approve' }],
        ['POST', '/merge', undefined],
      ] as const) {
        const res = await call(method, reviewUrl(second.id, onlyInFirst, rest), s.owner, payload);
        expect(res.statusCode).toBe(404);
        expect(errorOf(res).code).toBe('review_not_found');
      }

      const sameNumber = await call('GET', reviewUrl(second.id, s.review, '/reviewers'), s.owner);
      expect(sameNumber.json()).toEqual([]);
      const removeAcross = await call(
        'DELETE',
        reviewUrl(second.id, s.review, `/reviewers/${s.reviewer.id}`),
        s.owner,
      );
      expect(removeAcross.statusCode).toBe(404);
      expect(errorOf(removeAcross).code).toBe('reviewer_not_found');
      const list = await call('GET', s.url('/reviewers'), s.owner);
      expect(ReviewerSchema.array().parse(list.json())).toHaveLength(1);
    });

    it('a member of another workspace only gets 404s', async () => {
      const s = await setup();
      const outsiderOwner = await createUserWithSession(app.db);
      await createWorkspace(outsiderOwner);
      for (const rest of ['/state', '/reviewers', '/decisions', '/events']) {
        const res = await call('GET', s.url(rest), outsiderOwner);
        expect(res.statusCode).toBe(404);
        expect(errorOf(res).code).toBe('workspace_not_found');
      }
    });

    it.each([
      ['a malformed user id', 'not-a-uuid'],
      ['someone who reviews another review', 'other'],
      ['a member who reviews nothing', 'member'],
    ])('DELETE reviewers of %s → 404', async (_, kind) => {
      const s = await setup();
      let userId = kind;
      if (kind === 'other') {
        const otherReview = await createReview(s.workspace.id, s.author);
        const otherReviewer = await memberWithRole(s.workspace.id, 'member');
        await call('POST', reviewUrl(s.workspace.id, otherReview, '/reviewers'), s.author, {
          userIds: [otherReviewer.id],
        });
        userId = otherReviewer.id;
      } else if (kind === 'member') {
        userId = (await memberWithRole(s.workspace.id, 'member')).id;
      }
      const res = await call('DELETE', s.url(`/reviewers/${userId}`), s.owner);
      expect(res.statusCode).toBe(404);
      expect(errorOf(res).code).toBe('reviewer_not_found');
    });

    it('a malformed review number is 404 before anything else', async () => {
      const s = await setup();
      const res = await call('GET', `${BASE}/${s.workspace.id}/reviews/abc/state`, s.owner);
      expect(res.statusCode).toBe(404);
      expect(errorOf(res).code).toBe('review_not_found');
    });
  });
});
