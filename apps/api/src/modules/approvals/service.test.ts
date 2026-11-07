import { randomUUID } from 'node:crypto';
import type { ApprovalRules, Decision, WorkspaceRole } from '@diffcraft/shared';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';
import {
  reviewDecisions,
  reviewEvents,
  reviewReviewers,
  reviews,
  users,
} from '../../db/schema/index.js';
import { describeWithDb, testDatabaseUrl } from '../../test/db.js';
import { addMember, createUserWithSession, failInsertInTransaction } from '../../test/fixtures.js';
import { createThread, setThreadStatus } from '../comments/service.js';
import { createReview, deleteReview, getReview, updateReview } from '../reviews/service.js';
import { createWorkspace } from '../workspaces/service.js';
import {
  assignReviewers,
  getReviewState,
  getRules,
  listDecisions,
  listEvents,
  listReviewers,
  mergeReview,
  removeReviewer,
  submitDecision,
  updateRules,
} from './service.js';

const PATCH = `--- a/a.txt
+++ b/a.txt
@@ -1 +1 @@
-old
+new
`;

describeWithDb('approvals service', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp(loadConfig({ LOG_LEVEL: 'silent', DATABASE_URL: testDatabaseUrl }));
  });

  afterAll(async () => {
    await app.close();
  });

  async function user(displayName: string) {
    const created = await createUserWithSession(app.db);
    await app.db.update(users).set({ displayName }).where(eq(users.id, created.id));
    return created.id;
  }

  async function setup(rules?: Partial<ApprovalRules>) {
    const authorId = await user('Ada');
    const workspace = await createWorkspace(app.db, authorId, { name: `Team ${randomUUID()}` });
    const workspaceId = workspace.id;
    if (rules) {
      await updateRules(app.db, workspaceId, {
        requiredApprovals: 1,
        requireResolvedThreads: false,
        ...rules,
      });
    }
    const review = await createReview(app.db, {
      workspaceId,
      authorId,
      input: { title: 'Change', description: null, patch: PATCH },
    });
    const ids = { workspaceId, reviewId: review.id };

    const member = async (displayName: string, role: WorkspaceRole = 'member') => {
      const id = await user(displayName);
      await addMember(app.db, workspaceId, id, role);
      return id;
    };
    const assign = (...userIds: string[]) =>
      assignReviewers(app.db, { ...ids, actorId: authorId, userIds });
    const decide = (reviewerId: string, decision: Decision, body?: string) =>
      submitDecision(app.db, { ...ids, reviewerId, decision, body });
    const state = async () => (await getReviewState(app.db, workspaceId, review.id))!;
    const merge = (actorId = authorId) => mergeReview(app.db, { ...ids, actorId });
    const events = async () =>
      (await listEvents(app.db, workspaceId, review.id)).map((e) => e.type);

    return { ...ids, authorId, member, assign, decide, state, merge, events };
  }

  it('defaults the rules to one approval and threads not required, and updates them', async () => {
    const s = await setup();
    await expect(getRules(app.db, s.workspaceId)).resolves.toEqual({
      requiredApprovals: 1,
      requireResolvedThreads: false,
    });
    const rules = { requiredApprovals: 3, requireResolvedThreads: true };
    await expect(updateRules(app.db, s.workspaceId, rules)).resolves.toEqual(rules);
    await expect(getRules(app.db, s.workspaceId)).resolves.toEqual(rules);
    await expect(getRules(app.db, randomUUID())).resolves.toBeNull();
    await expect(
      updateRules(app.db, s.workspaceId, { requiredApprovals: 11, requireResolvedThreads: false }),
    ).rejects.toThrow();
  });

  it('with 0 required approvals: mergeable at once, approved after one approval', async () => {
    const s = await setup({ requiredApprovals: 0 });
    expect(await s.state()).toMatchObject({ state: 'pending', canMerge: true, reasons: [] });

    const bo = await s.member('Bo');
    await s.assign(bo);
    await s.decide(bo, 'approve');
    expect(await s.state()).toMatchObject({ state: 'approved', approvals: 1, canMerge: true });
  });

  it('with 1 required approval: pending until a reviewer approves', async () => {
    const s = await setup();
    const bo = await s.member('Bo');
    await s.assign(bo);
    expect(await s.state()).toMatchObject({
      state: 'pending',
      approvals: 0,
      requiredApprovals: 1,
      canMerge: false,
      reasons: ['0 of 1 required approval'],
    });

    await s.decide(bo, 'approve');
    expect(await s.state()).toMatchObject({ state: 'approved', canMerge: true, reasons: [] });
  });

  it('with 2 required approvals: one is not enough', async () => {
    const s = await setup({ requiredApprovals: 2 });
    const [bo, cy] = [await s.member('Bo'), await s.member('Cy')];
    await s.assign(bo, cy);

    await s.decide(bo, 'approve');
    expect(await s.state()).toMatchObject({
      state: 'pending',
      canMerge: false,
      reasons: ['1 of 2 required approvals'],
    });

    await s.decide(cy, 'approve');
    expect(await s.state()).toMatchObject({ state: 'approved', approvals: 2, canMerge: true });
  });

  it('blocks on a request for changes, and the latest decision wins', async () => {
    const s = await setup();
    const [bo, ravi] = [await s.member('Bo'), await s.member('Ravi')];
    await s.assign(bo, ravi);
    await s.decide(bo, 'approve');
    await s.decide(ravi, 'request_changes', 'Please add tests.');

    expect(await s.state()).toMatchObject({
      state: 'changes_requested',
      approvals: 1,
      canMerge: false,
      reasons: ['Ravi requested changes'],
    });

    await s.decide(ravi, 'approve');
    expect(await s.state()).toMatchObject({ state: 'approved', approvals: 2, canMerge: true });

    await s.decide(bo, 'request_changes');
    expect(await s.state()).toMatchObject({ state: 'changes_requested', approvals: 1 });

    const reviewers = await listReviewers(app.db, s.workspaceId, s.reviewId);
    expect(reviewers.map((r) => [r.user.displayName, r.latestDecision])).toEqual([
      ['Bo', 'request_changes'],
      ['Ravi', 'approve'],
    ]);
    const history = await app.db
      .select()
      .from(reviewDecisions)
      .where(eq(reviewDecisions.reviewId, s.reviewId));
    expect(history).toHaveLength(4);
  });

  it("stops counting a removed reviewer's decisions but keeps them in history", async () => {
    const s = await setup();
    const [bo, ravi] = [await s.member('Bo'), await s.member('Ravi')];
    await s.assign(bo, ravi);
    await s.decide(bo, 'approve');
    await s.decide(ravi, 'request_changes');

    await expect(removeReviewer(app.db, { ...s, actorId: s.authorId, userId: ravi })).resolves.toBe(
      true,
    );
    expect(await s.state()).toMatchObject({ state: 'approved', canMerge: true });

    await expect(removeReviewer(app.db, { ...s, actorId: s.authorId, userId: bo })).resolves.toBe(
      true,
    );
    expect(await s.state()).toMatchObject({ state: 'pending', approvals: 0, canMerge: false });

    await expect(removeReviewer(app.db, { ...s, actorId: s.authorId, userId: bo })).resolves.toBe(
      false,
    );
    const history = await app.db
      .select()
      .from(reviewDecisions)
      .where(eq(reviewDecisions.reviewId, s.reviewId));
    expect(history).toHaveLength(2);
    expect((await s.events()).filter((type) => type === 'reviewer_removed')).toHaveLength(2);
  });

  it('counts only decisions made since the current assignment after a re-assignment', async () => {
    const s = await setup();
    const bo = await s.member('Bo');
    await s.assign(bo);
    await s.decide(bo, 'approve');
    expect(await s.state()).toMatchObject({ state: 'approved', canMerge: true });

    await removeReviewer(app.db, { ...s, actorId: s.authorId, userId: bo });
    await s.assign(bo);
    expect(await s.state()).toMatchObject({ state: 'pending', approvals: 0, canMerge: false });
    expect(await listReviewers(app.db, s.workspaceId, s.reviewId)).toEqual([
      { user: { id: bo, displayName: 'Bo' }, latestDecision: null, decidedAt: null },
    ]);
    await expect(s.merge()).rejects.toMatchObject({ code: 'merge_blocked' });

    await s.decide(bo, 'approve');
    expect(await s.state()).toMatchObject({ state: 'approved', approvals: 1, canMerge: true });
    expect((await s.merge()).status).toBe('merged');
  });

  it('lists every decision oldest first, including former reviewers and deleted users', async () => {
    const s = await setup();
    const [bo, cy] = [await s.member('Bo'), await s.member('Cy')];
    await s.assign(bo, cy);
    await s.decide(bo, 'request_changes', 'Rename it');
    await s.decide(cy, 'approve');
    await s.decide(bo, 'approve');
    await removeReviewer(app.db, { ...s, actorId: s.authorId, userId: cy });
    await app.db.delete(users).where(eq(users.id, bo));

    const decisions = await listDecisions(app.db, s.workspaceId, s.reviewId);
    expect(decisions.map((d) => [d.reviewer?.id ?? null, d.decision, d.body])).toEqual([
      [null, 'request_changes', 'Rename it'],
      [cy, 'approve', null],
      [null, 'approve', null],
    ]);
    const other = await setup();
    await expect(listDecisions(app.db, other.workspaceId, s.reviewId)).resolves.toEqual([]);
  });

  it('updates only the rules that are given', async () => {
    const s = await setup();
    await expect(updateRules(app.db, s.workspaceId, { requiredApprovals: 2 })).resolves.toEqual({
      requiredApprovals: 2,
      requireResolvedThreads: false,
    });
    await expect(
      updateRules(app.db, s.workspaceId, { requireResolvedThreads: true }),
    ).resolves.toEqual({ requiredApprovals: 2, requireResolvedThreads: true });
  });

  it('applies the resolved-threads rule only when it is on', async () => {
    const s = await setup();
    const bo = await s.member('Bo');
    await s.assign(bo);
    await s.decide(bo, 'approve');
    const thread = await createThread(app.db, {
      ...s,
      authorId: bo,
      input: { body: 'Why?' },
    });
    await createThread(app.db, { ...s, authorId: bo, input: { body: 'And this?' } });

    expect(await s.state()).toMatchObject({ openThreads: 2, canMerge: true });

    await updateRules(app.db, s.workspaceId, {
      requiredApprovals: 1,
      requireResolvedThreads: true,
    });
    expect(await s.state()).toMatchObject({ canMerge: false, reasons: ['2 unresolved threads'] });

    await setThreadStatus(app.db, { ...s, threadId: thread.id, userId: bo, status: 'resolved' });
    expect(await s.state()).toMatchObject({ openThreads: 1, reasons: ['1 unresolved thread'] });
  });

  it('assigns members and admins, ignores duplicates, and writes one event per new reviewer', async () => {
    const s = await setup();
    const [bo, cy] = [await s.member('Bo'), await s.member('Cy', 'admin')];

    const first = await s.assign(bo);
    expect(first.map((r) => r.user)).toEqual([{ id: bo, displayName: 'Bo' }]);
    expect(first[0]).toMatchObject({ latestDecision: null, decidedAt: null });

    const second = await s.assign(bo, cy);
    expect(second.map((r) => r.user.id)).toEqual([bo, cy]);
    await s.assign(cy);

    const events = await listEvents(app.db, s.workspaceId, s.reviewId);
    expect(events.map((e) => [e.type, e.data, e.actor?.displayName])).toEqual([
      ['reviewer_assigned', { userId: bo }, 'Ada'],
      ['reviewer_assigned', { userId: cy }, 'Ada'],
    ]);
    const [row] = await app.db
      .select()
      .from(reviewReviewers)
      .where(and(eq(reviewReviewers.reviewId, s.reviewId), eq(reviewReviewers.userId, bo)));
    expect(row?.assignedBy).toBe(s.authorId);
  });

  it('refuses the author, viewers and non-members with 422, assigning no one', async () => {
    const s = await setup();
    const bo = await s.member('Bo');
    const viewer = await s.member('Vi', 'viewer');
    const outsider = await user('Out');
    const missing = randomUUID();

    await expect(s.assign(bo, s.authorId, viewer, outsider, missing)).rejects.toMatchObject({
      statusCode: 422,
      code: 'invalid_reviewers',
      details: [
        { userId: s.authorId, reason: 'author' },
        { userId: viewer, reason: 'viewer' },
        { userId: outsider, reason: 'not_a_member' },
        { userId: missing, reason: 'not_a_member' },
      ],
    });
    await expect(listReviewers(app.db, s.workspaceId, s.reviewId)).resolves.toEqual([]);
    expect(await s.events()).toEqual([]);
  });

  it('refuses a member of another workspace', async () => {
    const s = await setup();
    const other = await setup();
    const theirs = await other.member('Bo');
    await expect(s.assign(theirs)).rejects.toMatchObject({ code: 'invalid_reviewers' });
  });

  it('accepts decisions only from assigned reviewers on open reviews', async () => {
    const s = await setup();
    const [bo, cy] = [await s.member('Bo'), await s.member('Cy', 'owner')];
    await s.assign(bo);

    await expect(s.decide(cy, 'approve')).rejects.toMatchObject({
      statusCode: 403,
      code: 'not_a_reviewer',
    });
    await expect(s.decide(s.authorId, 'approve')).rejects.toMatchObject({
      code: 'not_a_reviewer',
    });

    const decision = await s.decide(bo, 'request_changes', 'Rename it.');
    expect(decision).toMatchObject({
      reviewId: s.reviewId,
      reviewer: { id: bo, displayName: 'Bo' },
      decision: 'request_changes',
      body: 'Rename it.',
    });
    const [event] = (await listEvents(app.db, s.workspaceId, s.reviewId)).filter(
      (e) => e.type === 'decision',
    );
    expect(event).toMatchObject({
      actor: { id: bo },
      data: { decisionId: decision.id, decision: 'request_changes' },
    });

    await updateReview(app.db, { ...s, actorId: s.authorId, changes: { status: 'closed' } });
    await expect(s.decide(bo, 'approve')).rejects.toMatchObject({
      statusCode: 409,
      code: 'review_not_open',
    });
  });

  it('refuses decisions on a merged review', async () => {
    const s = await setup({ requiredApprovals: 0 });
    const bo = await s.member('Bo');
    await s.assign(bo);
    await s.merge();
    await expect(s.decide(bo, 'approve')).rejects.toMatchObject({ code: 'review_not_open' });
  });

  it('merges only when the rules pass, recording who and when', async () => {
    const s = await setup();
    const bo = await s.member('Bo');
    const admin = await s.member('Root', 'admin');
    await s.assign(bo);

    await expect(s.merge()).rejects.toMatchObject({
      statusCode: 409,
      code: 'merge_blocked',
      details: { reasons: ['0 of 1 required approval'] },
    });
    expect((await getReview(app.db, s.workspaceId, s.reviewId))?.status).toBe('open');

    await s.decide(bo, 'approve');
    const merged = await s.merge(admin);
    expect(merged.status).toBe('merged');

    const [row] = await app.db.select().from(reviews).where(eq(reviews.id, s.reviewId));
    expect(row?.mergedBy).toBe(admin);
    expect(row?.mergedAt).toBeInstanceOf(Date);
    const events = await listEvents(app.db, s.workspaceId, s.reviewId);
    expect(events.at(-1)).toMatchObject({
      type: 'merged',
      actor: { id: admin, displayName: 'Root' },
    });

    await expect(s.merge()).rejects.toMatchObject({ statusCode: 409, code: 'review_merged' });
    expect(await s.state()).toMatchObject({ canMerge: false });
  });

  it('refuses to merge a closed review or one in another workspace', async () => {
    const s = await setup({ requiredApprovals: 0 });
    const other = await setup();
    await expect(
      mergeReview(app.db, {
        workspaceId: other.workspaceId,
        reviewId: s.reviewId,
        actorId: s.authorId,
      }),
    ).rejects.toMatchObject({ statusCode: 404, code: 'review_not_found' });

    await updateReview(app.db, { ...s, actorId: s.authorId, changes: { status: 'closed' } });
    await expect(s.merge()).rejects.toMatchObject({
      details: { reasons: ['The review is closed'] },
    });
  });

  it('never merges past a request for changes that races with the merge', async () => {
    const outcomes = { merged: 0, blocked: 0 };
    for (let run = 0; run < 25; run++) {
      const s = await setup();
      const bo = await s.member('Bo');
      await s.assign(bo);
      await s.decide(bo, 'approve');

      const [decision, merge] = await Promise.allSettled([
        s.decide(bo, 'request_changes'),
        s.merge(),
      ]);
      // Exactly one wins: the merge sees the request, or the request sees a merged review.
      expect([decision.status, merge.status].sort()).toEqual(['fulfilled', 'rejected']);
      if (merge.status === 'fulfilled') {
        outcomes.merged++;
        expect(decision).toMatchObject({ reason: { code: 'review_not_open' } });
      } else {
        outcomes.blocked++;
        expect(merge.reason).toMatchObject({ code: 'merge_blocked' });
      }

      const [review] = await app.db.select().from(reviews).where(eq(reviews.id, s.reviewId));
      const requests = await app.db
        .select()
        .from(reviewDecisions)
        .where(
          and(
            eq(reviewDecisions.reviewId, s.reviewId),
            eq(reviewDecisions.decision, 'request_changes'),
          ),
        );
      if (review?.status === 'merged') {
        expect(requests).toEqual([]);
      } else {
        expect(review?.status).toBe('open');
        expect(requests).toHaveLength(1);
      }
    }
    expect(outcomes.merged + outcomes.blocked).toBe(25);
  });

  it('writes nothing when the event insert fails', async () => {
    const s = await setup({ requiredApprovals: 0 });
    const bo = await s.member('Bo');
    await s.assign(bo);
    const failing = failInsertInTransaction(app.db, reviewEvents, 'forced event failure');
    const ids = { workspaceId: s.workspaceId, reviewId: s.reviewId };

    await expect(
      submitDecision(failing, { ...ids, reviewerId: bo, decision: 'approve' }),
    ).rejects.toThrow('forced event failure');
    expect(
      await app.db.select().from(reviewDecisions).where(eq(reviewDecisions.reviewId, s.reviewId)),
    ).toEqual([]);

    const cy = await s.member('Cy');
    await expect(
      assignReviewers(failing, { ...ids, actorId: s.authorId, userIds: [cy] }),
    ).rejects.toThrow('forced event failure');
    expect((await listReviewers(app.db, s.workspaceId, s.reviewId)).map((r) => r.user.id)).toEqual([
      bo,
    ]);

    await expect(
      removeReviewer(failing, { ...ids, actorId: s.authorId, userId: bo }),
    ).rejects.toThrow('forced event failure');
    expect(await listReviewers(app.db, s.workspaceId, s.reviewId)).toHaveLength(1);

    await expect(mergeReview(failing, { ...ids, actorId: s.authorId })).rejects.toThrow(
      'forced event failure',
    );
    await expect(
      updateReview(failing, { ...ids, actorId: s.authorId, changes: { status: 'closed' } }),
    ).rejects.toThrow('forced event failure');
    expect((await getReview(app.db, s.workspaceId, s.reviewId))?.status).toBe('open');
  });

  it('closes and reopens through the allowed transitions, with an event each', async () => {
    const s = await setup();
    const change = (status: 'open' | 'closed') =>
      updateReview(app.db, { ...s, actorId: s.authorId, changes: { status } });

    expect((await change('closed'))?.status).toBe('closed');
    expect((await change('closed'))?.status).toBe('closed');
    expect((await change('open'))?.status).toBe('open');
    await updateReview(app.db, { ...s, actorId: s.authorId, changes: { title: 'Renamed' } });

    expect(await s.events()).toEqual(['closed', 'reopened']);
    await expect(
      updateReview(app.db, {
        workspaceId: s.workspaceId,
        reviewId: randomUUID(),
        actorId: s.authorId,
        changes: { status: 'closed' },
      }),
    ).resolves.toBeNull();
  });

  it('keeps a merged review final: no edit, close, reopen, delete or reviewer change', async () => {
    const s = await setup({ requiredApprovals: 0 });
    const bo = await s.member('Bo');
    await s.merge();
    const actorId = s.authorId;
    const merged = { statusCode: 409, code: 'review_merged' };

    for (const changes of [
      { title: 'New' },
      { status: 'closed' as const },
      { status: 'open' as const },
    ]) {
      await expect(updateReview(app.db, { ...s, actorId, changes })).rejects.toMatchObject(merged);
    }
    await expect(deleteReview(app.db, s.workspaceId, s.reviewId)).rejects.toMatchObject(merged);
    await expect(s.assign(bo)).rejects.toMatchObject(merged);
    await expect(removeReviewer(app.db, { ...s, actorId, userId: bo })).rejects.toMatchObject(
      merged,
    );

    expect(await getReview(app.db, s.workspaceId, s.reviewId)).toMatchObject({
      status: 'merged',
      title: 'Change',
    });
    expect(await s.events()).toEqual(['merged']);
  });

  it('refuses a closed → merged transition and keeps merged_at in step with the status', async () => {
    const s = await setup();
    await expect(
      app.db.update(reviews).set({ status: 'merged' }).where(eq(reviews.id, s.reviewId)),
    ).rejects.toThrow();
    await expect(
      app.db.update(reviews).set({ mergedAt: new Date() }).where(eq(reviews.id, s.reviewId)),
    ).rejects.toThrow();
  });

  it('hides reviewers and events of a review in another workspace', async () => {
    const s = await setup();
    const other = await setup();
    const bo = await s.member('Bo');
    await s.assign(bo);

    await expect(listReviewers(app.db, other.workspaceId, s.reviewId)).resolves.toEqual([]);
    await expect(listEvents(app.db, other.workspaceId, s.reviewId)).resolves.toEqual([]);
    await expect(getReviewState(app.db, other.workspaceId, s.reviewId)).resolves.toBeNull();
    await expect(
      submitDecision(app.db, {
        workspaceId: other.workspaceId,
        reviewId: s.reviewId,
        reviewerId: bo,
        decision: 'approve',
      }),
    ).rejects.toMatchObject({ code: 'review_not_found' });
  });

  it('deletes reviewers, decisions and events with the review', async () => {
    const s = await setup();
    const bo = await s.member('Bo');
    await s.assign(bo);
    await s.decide(bo, 'approve');

    await deleteReview(app.db, s.workspaceId, s.reviewId);

    for (const [table, column] of [
      [reviewReviewers, reviewReviewers.reviewId],
      [reviewDecisions, reviewDecisions.reviewId],
      [reviewEvents, reviewEvents.reviewId],
    ] as const) {
      expect(await app.db.select().from(table).where(eq(column, s.reviewId))).toEqual([]);
    }
  });

  it('keeps decisions, events and the merge when the people involved delete their accounts', async () => {
    const s = await setup();
    const bo = await s.member('Bo');
    const admin = await s.member('Root', 'admin');
    await s.assign(bo);
    await s.decide(bo, 'approve');
    await s.merge(admin);

    await app.db.delete(users).where(eq(users.id, bo));
    await app.db.delete(users).where(eq(users.id, admin));

    await expect(listReviewers(app.db, s.workspaceId, s.reviewId)).resolves.toEqual([]);
    const decisions = await app.db
      .select()
      .from(reviewDecisions)
      .where(eq(reviewDecisions.reviewId, s.reviewId));
    expect(decisions.map((d) => [d.reviewerId, d.decision])).toEqual([[null, 'approve']]);

    const events = await listEvents(app.db, s.workspaceId, s.reviewId);
    expect(events.map((e) => [e.type, e.actor?.id ?? null])).toEqual([
      ['reviewer_assigned', s.authorId],
      ['decision', null],
      ['merged', null],
    ]);
    const [review] = await app.db.select().from(reviews).where(eq(reviews.id, s.reviewId));
    expect(review).toMatchObject({ status: 'merged', mergedBy: null });
    expect(review?.mergedAt).toBeInstanceOf(Date);
  });
});
