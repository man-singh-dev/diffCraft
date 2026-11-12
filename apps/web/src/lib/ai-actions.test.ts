import type { AiFinding, AiJob, LatestAnalysisResponse } from '@diffcraft/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServerApiResult, ServerSendResult } from './api.server.js';
import { aiFinding, aiJob } from './ai-fixture';

vi.mock('server-only', () => ({}));
const api = {
  postAnalysis: vi.fn<(...args: unknown[]) => Promise<ServerSendResult<AiJob>>>(),
  postDismissFinding: vi.fn<(...args: unknown[]) => Promise<ServerSendResult<AiFinding>>>(),
  sendFindingFeedback: vi.fn<(...args: unknown[]) => Promise<ServerSendResult<AiFinding>>>(),
  getLatestAnalysis:
    vi.fn<(...args: unknown[]) => Promise<ServerApiResult<LatestAnalysisResponse>>>(),
};
vi.mock('./api.server', () => api);

const { dismissFinding, loadLatestAnalysis, runAnalysis, setFindingFeedback } =
  await import('./ai-actions.js');
const { runAiAction, toAiError } = await import('./ai-errors.js');

const WS = '3f2b8c1e-5d4a-4e6b-9c7d-1a2b3c4d5e6f';
const FINDING = '01a17e5e-aa56-7985-be46-bf5f1c7e7fd0';

const failure = (status: number, code: string | null, extra: object = {}) => ({
  ok: false as const,
  status,
  code,
  fieldErrors: {},
  ...extra,
});

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
});

describe('argument validation (no API call)', () => {
  it.each([
    ['workspace id not a uuid', ['nope', '1']],
    ['review number with a leading zero', [WS, '01']],
    ['review number as a number', [WS, 1]],
  ])('%s → not_found', async (_name, [ws, number]) => {
    for (const result of [
      await runAnalysis(ws, number),
      await loadLatestAnalysis(ws, number),
      await dismissFinding(ws, number, FINDING),
      await setFindingFeedback(ws, number, FINDING, { helpful: true }),
    ]) {
      expect(result).toMatchObject({ ok: false, error: { code: 'not_found' } });
    }
    for (const fn of Object.values(api)) expect(fn).not.toHaveBeenCalled();
  });

  it.each([['nope'], [`${FINDING}/../x`], [undefined], [42]])(
    'finding id %j → not_found',
    async (findingId) => {
      expect(await dismissFinding(WS, '1', findingId)).toMatchObject({
        ok: false,
        error: { code: 'not_found', message: expect.stringMatching(/finding/) },
      });
      expect(await setFindingFeedback(WS, '1', findingId, { helpful: true })).toMatchObject({
        ok: false,
      });
      expect(api.postDismissFinding).not.toHaveBeenCalled();
      expect(api.sendFindingFeedback).not.toHaveBeenCalled();
    },
  );

  it.each([[{}], [{ helpful: 'yes' }], [null], ['true'], [{ helpful: 1 }]])(
    'feedback %j → invalid',
    async (input) => {
      expect(await setFindingFeedback(WS, '1', FINDING, input)).toMatchObject({
        ok: false,
        error: { code: 'invalid' },
      });
      expect(api.sendFindingFeedback).not.toHaveBeenCalled();
    },
  );
});

describe('calls', () => {
  it('runs an analysis', async () => {
    const job = aiJob({ status: 'queued' });
    api.postAnalysis.mockResolvedValue({ ok: true, data: job });
    expect(await runAnalysis(WS, '7')).toEqual({ ok: true, data: job });
    expect(api.postAnalysis).toHaveBeenCalledWith(WS, '7');
  });

  it.each([true, false, null])('sends feedback %j (null removes it)', async (helpful) => {
    const finding = aiFinding();
    api.sendFindingFeedback.mockResolvedValue({ ok: true, data: finding });
    expect(await setFindingFeedback(WS, '7', FINDING, { helpful })).toEqual({
      ok: true,
      data: finding,
    });
    expect(api.sendFindingFeedback).toHaveBeenCalledWith(WS, '7', FINDING, helpful);
  });

  it('loads the latest analysis with the time it was asked for', async () => {
    const latest = { enabled: true, job: null, findings: [] };
    api.getLatestAnalysis.mockResolvedValue({ ok: true, data: latest });
    const before = new Date().toISOString();
    const result = await loadLatestAnalysis(WS, '7');
    expect(result).toMatchObject({ ok: true, data: { latest } });
    expect(result.ok && result.data.loadedAt >= before).toBe(true);
  });
});

describe('toAiError', () => {
  it('uses Retry-After on 429', () => {
    expect(
      toAiError(failure(429, 'analysis_limit_reached', { retryAfterSeconds: 3600 })),
    ).toMatchObject({ code: 'rate_limited', retryAfterSeconds: 3600 });
  });

  it('falls back to the details when the header is missing', () => {
    expect(
      toAiError(failure(429, 'analysis_limit_reached', { details: { retryAfterSeconds: 60 } })),
    ).toMatchObject({ code: 'rate_limited', retryAfterSeconds: 60 });
    expect(toAiError(failure(429, null))).not.toHaveProperty('retryAfterSeconds');
  });

  it.each([
    [401, null, 'unauthorized'],
    [503, 'ai_disabled', 'disabled'],
    [409, 'review_not_open', 'conflict'],
    [404, 'finding_not_found', 'not_found'],
    [404, 'review_not_found', 'not_found'],
    [403, 'forbidden', 'forbidden'],
    [500, null, 'failed'],
    [0, null, 'failed'],
  ])('%i %s → %s', (status, code, expected) => {
    expect(toAiError(failure(status, code)).code).toBe(expected);
  });

  it('maps a thrown action to a network error', async () => {
    expect(await runAiAction(() => Promise.reject(new Error('offline')))).toMatchObject({
      ok: false,
      error: { code: 'failed', message: expect.stringMatching(/reach the server/) },
    });
  });
});
