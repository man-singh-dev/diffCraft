import type { ApprovalRules, Review, ReviewDecision, Reviewer } from '@diffcraft/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServerSendResult } from './api.server.js';

// server-only throws outside a React Server Components build.
vi.mock('server-only', () => ({}));
const api = {
  postReviewers: vi.fn<(...args: unknown[]) => Promise<ServerSendResult<Reviewer[]>>>(),
  deleteReviewerRequest: vi.fn<(...args: unknown[]) => Promise<ServerSendResult<undefined>>>(),
  postDecision: vi.fn<(...args: unknown[]) => Promise<ServerSendResult<ReviewDecision>>>(),
  postMerge: vi.fn<(...args: unknown[]) => Promise<ServerSendResult<Review>>>(),
  patchRules: vi.fn<(...args: unknown[]) => Promise<ServerSendResult<ApprovalRules>>>(),
};
vi.mock('./api.server', () => api);

const { assignReviewers, mergeReview, removeReviewer, submitDecision, updateRules } =
  await import('./approval-actions.js');
const { run } = await import('./approval-errors.js');

const WS = '3f2b8c1e-5d4a-4e6b-9c7d-1a2b3c4d5e6f';
const USER = '01a17e5e-aa56-7985-be46-bf5f1c7e7fd0';
const OTHER = '01a17e5e-aa56-7985-be46-bf5f1c7e7fd1';

const failure = (status: number, code: string | null, details?: unknown) => ({
  ok: false as const,
  status,
  code,
  fieldErrors: {},
  ...(details !== undefined && { details }),
});

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
});

const notCalled = () => {
  for (const fn of Object.values(api)) expect(fn).not.toHaveBeenCalled();
};

describe('argument validation (no API call)', () => {
  it.each([
    ['workspace id not a uuid', ['nope', '1']],
    ['workspace id with a path', [`../${WS}`, '1']],
    ['review number with a leading zero', [WS, '01']],
    ['review number over int4', [WS, '2147483648']],
    ['review number as a number', [WS, 1]],
  ])('%s → not_found', async (_name, [ws, number]) => {
    for (const result of [
      await assignReviewers(ws, number, { userIds: [USER] }),
      await removeReviewer(ws, number, USER),
      await submitDecision(ws, number, { decision: 'approve' }),
      await mergeReview(ws, number),
    ]) {
      expect(result).toMatchObject({ ok: false, error: { code: 'not_found' } });
    }
    notCalled();
  });

  it.each([['nope'], [`${USER}/../x`], [undefined], [42]])(
    'reviewer id %j → not_found',
    async (bad) => {
      expect(await removeReviewer(WS, '1', bad)).toMatchObject({
        ok: false,
        error: { code: 'not_found' },
      });
      expect(await updateRules(bad, { requiredApprovals: 1 })).toMatchObject({
        ok: false,
        error: { code: 'not_found' },
      });
      notCalled();
    },
  );

  it.each([
    { userIds: [] },
    { userIds: ['nope'] },
    { userIds: [USER, USER] },
    { userIds: Array.from({ length: 11 }, (_, i) => `${USER.slice(0, -2)}${10 + i}`) },
    'not an object',
    null,
  ])('assign %j → invalid', async (input) => {
    expect(await assignReviewers(WS, '1', input)).toMatchObject({
      ok: false,
      error: { code: 'invalid' },
    });
    notCalled();
  });

  it.each([
    ['unknown decision', { decision: 'maybe' }],
    ['no decision', {}],
    ['body too long', { decision: 'approve', body: 'x'.repeat(10_001) }],
    ['body with a NUL', { decision: 'approve', body: 'a\u0000b' }],
    ['not an object', 'approve'],
  ])('decision %s → invalid', async (_name, input) => {
    expect(await submitDecision(WS, '1', input)).toMatchObject({
      ok: false,
      error: { code: 'invalid' },
    });
    notCalled();
  });

  it.each([{}, { requiredApprovals: 11 }, { requiredApprovals: -1 }, { requiredApprovals: '2' }])(
    'rules %j → invalid',
    async (input) => {
      expect(await updateRules(WS, input)).toMatchObject({
        ok: false,
        error: { code: 'invalid' },
      });
      notCalled();
    },
  );
});

describe('calling the API', () => {
  it('drops a blank decision comment and trims a real one', async () => {
    api.postDecision.mockResolvedValue(failure(500, null));
    await submitDecision(WS, '3', { decision: 'approve', body: '   ' });
    expect(api.postDecision).toHaveBeenLastCalledWith(WS, '3', { decision: 'approve' });
    await submitDecision(WS, '3', { decision: 'request_changes', body: '  Rename it  ' });
    expect(api.postDecision).toHaveBeenLastCalledWith(WS, '3', {
      decision: 'request_changes',
      body: 'Rename it',
    });
  });

  it('returns null after removing a reviewer', async () => {
    api.deleteReviewerRequest.mockResolvedValue({ ok: true, data: undefined });
    expect(await removeReviewer(WS, '3', USER)).toEqual({ ok: true, data: null });
    expect(api.deleteReviewerRequest).toHaveBeenCalledWith(WS, '3', USER);
  });

  it('passes partial rules through', async () => {
    const rules = { requiredApprovals: 2, requireResolvedThreads: false };
    api.patchRules.mockResolvedValue({ ok: true, data: rules });
    expect(await updateRules(WS, { requiredApprovals: 2 })).toEqual({ ok: true, data: rules });
    expect(api.patchRules).toHaveBeenCalledWith(WS, { requiredApprovals: 2 });
  });
});

describe('error mapping', () => {
  it('returns the reasons of merge_blocked', async () => {
    api.postMerge.mockResolvedValue(
      failure(409, 'merge_blocked', {
        reasons: ['Ravi requested changes', '0 of 1 required approval'],
      }),
    );
    expect(await mergeReview(WS, '3')).toEqual({
      ok: false,
      error: {
        code: 'conflict',
        message: "This review can't be merged yet.",
        reasons: ['Ravi requested changes', '0 of 1 required approval'],
      },
    });
  });

  it('copes with merge_blocked without usable details', async () => {
    api.postMerge.mockResolvedValue(failure(409, 'merge_blocked', { reasons: 'nope' }));
    expect(await mergeReview(WS, '3')).toMatchObject({ ok: false, error: { reasons: [] } });
  });

  it('gives one message per invalid reviewer', async () => {
    api.postReviewers.mockResolvedValue(
      failure(422, 'invalid_reviewers', [
        { userId: USER, reason: 'viewer' },
        { userId: OTHER, reason: 'not_a_member' },
      ]),
    );
    expect(await assignReviewers(WS, '3', { userIds: [USER, OTHER] })).toEqual({
      ok: false,
      error: {
        code: 'invalid',
        message: "Some of these people can't review this change.",
        reviewerErrors: [
          { userId: USER, message: 'is a viewer, and viewers cannot review' },
          { userId: OTHER, message: 'is not a member of this workspace any more' },
        ],
      },
    });
  });

  it.each([
    [403, 'not_a_reviewer', 'forbidden', /not a reviewer/],
    [409, 'review_not_open', 'conflict', /closed or merged/],
    [409, 'review_merged', 'conflict', /already been merged/],
    [404, 'reviewer_not_found', 'not_found', /no longer a reviewer/],
    [403, 'forbidden', 'forbidden', /permission/],
    [401, 'unauthenticated', 'unauthorized', /session has ended/],
    [404, 'review_not_found', 'not_found', /doesn't exist/],
    [500, null, 'failed', /try again/],
  ])('%i %s → %s', async (status, code, expected, message) => {
    api.postDecision.mockResolvedValue(failure(status, code));
    const result = await submitDecision(WS, '3', { decision: 'approve' });
    expect(result).toMatchObject({ ok: false, error: { code: expected } });
    expect(result.ok ? '' : result.error.message).toMatch(message);
  });

  it('never returns the API failure as is', async () => {
    api.postMerge.mockResolvedValue(failure(403, 'forbidden'));
    const result = await mergeReview(WS, '3');
    expect(JSON.stringify(result)).not.toMatch(/status|fieldErrors/);
  });
});

describe('run', () => {
  it('turns a thrown error into a failure', async () => {
    expect(
      await run(() => {
        throw new Error('Failed to find Server Action');
      }),
    ).toMatchObject({ ok: false, error: { code: 'failed', message: /reach the server/ } });
  });
});
