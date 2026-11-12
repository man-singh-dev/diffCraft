import { commentSuggestion, parseCommentBody } from '@diffcraft/shared';
import { describe, expect, it, vi } from 'vitest';
import {
  analysisReducer,
  availableAt,
  findingLocation,
  findingThreadBody,
  groupBySeverity,
  groupFindingsByKey,
  initialAnalysisState,
  jobErrorMessage,
  optimistic,
  severityCounts,
  visibleFindings,
  withFeedback,
  type AnalysisState,
} from './ai-analysis';
import { AI_FILE, aiFinding, aiJob } from './ai-fixture';
import { threadKey } from './thread-anchors';

const LOADED = '2026-11-12T10:01:00.000Z';
const BEFORE = '2026-11-12T10:00:59.000Z';
const AFTER = '2026-11-12T10:01:01.000Z';

const state = (overrides: Partial<AnalysisState> = {}): AnalysisState => ({
  ...initialAnalysisState({ enabled: true, job: aiJob(), findings: [] }, LOADED),
  ...overrides,
});

describe('groupBySeverity', () => {
  it('orders groups from critical to info and keeps the order inside a group', () => {
    const lowA = aiFinding({ severity: 'low', title: 'a' });
    const critical = aiFinding({ severity: 'critical' });
    const info = aiFinding({ severity: 'info' });
    const lowB = aiFinding({ severity: 'low', title: 'b' });
    const groups = groupBySeverity([lowA, info, critical, lowB]);
    expect(groups.map((g) => g.severity)).toEqual(['critical', 'low', 'info']);
    expect(groups[1]!.findings).toEqual([lowA, lowB]);
  });

  it('counts by severity in the same order', () => {
    expect(
      severityCounts([
        aiFinding({ severity: 'low' }),
        aiFinding({ severity: 'high' }),
        aiFinding({ severity: 'low' }),
      ]),
    ).toBe('1 high · 2 low');
  });
});

describe('jobErrorMessage', () => {
  it.each([
    ['provider_rate_limited', /rate limiting/],
    ['provider_timeout', /took too long/],
    ['timed_out', /took too long/],
    ['invalid_output', /couldn't be read/],
    ['provider_auth', /API key or model/],
    ['provider_model_not_found', /API key or model/],
    ['provider_unavailable', /unavailable/],
    ['provider_rejected', /refused/],
    ['internal_error', /on our side/],
    ['something_new', /on our side/],
    [null, /on our side/],
  ])('%s', (code, message) => {
    expect(jobErrorMessage(code)).toMatch(message);
  });
});

it('availableAt adds Retry-After seconds to now', () => {
  expect(availableAt(3600, Date.parse('2026-11-12T10:00:00.000Z'))).toBe(
    '2026-11-12T11:00:00.000Z',
  );
});

describe('findingThreadBody', () => {
  it('has the title and explanation', () => {
    const body = findingThreadBody(aiFinding({ title: 'Leak', explanation: 'Never closed.' }));
    expect(body).toBe('**Leak**\n\nNever closed.');
    expect(commentSuggestion(body)).toBeNull();
  });

  it('adds a suggestion block for a one-line finding on the new side', () => {
    const body = findingThreadBody(
      aiFinding({ title: 'Leak', explanation: 'Never closed.', suggestion: 'f.close();' }),
    );
    expect(body).toBe('**Leak**\n\nNever closed.\n\n```suggestion\nf.close();\n```');
    expect(commentSuggestion(body)).toEqual(['f.close();']);
  });

  it.each([
    ['the old side', { side: 'old' as const }],
    ['several lines', { lineEnd: 4 }],
  ])('leaves the suggestion out on %s', (_name, overrides) => {
    const body = findingThreadBody(aiFinding({ suggestion: 'x();', ...overrides }));
    expect(parseCommentBody(body).some((part) => part.type === 'suggestion')).toBe(false);
  });
});

describe('placement', () => {
  it('groups findings by file, side and first line', () => {
    const onNew = aiFinding({ side: 'new', lineStart: 3, lineEnd: 5 });
    const onOld = aiFinding({ side: 'old', lineStart: 3, lineEnd: 3 });
    const noLine = aiFinding({ reviewFileId: null, lineStart: null, lineEnd: null });
    const groups = groupFindingsByKey([onNew, onOld, noLine]);
    expect([...groups.keys()]).toEqual([
      threadKey(AI_FILE, 'new', 3),
      threadKey(AI_FILE, 'old', 3),
    ]);
    expect(groups.get(threadKey(AI_FILE, 'new', 3))).toEqual([onNew]);
  });

  it('describes the location', () => {
    expect(findingLocation(aiFinding({ lineStart: 3, lineEnd: 5 }))).toBe('src/app.ts:3-5');
    expect(findingLocation(aiFinding({ lineStart: 3, lineEnd: 3 }))).toBe('src/app.ts:3');
  });
});

describe('analysisReducer', () => {
  it('applies status events in order and ignores older ones', () => {
    const queued = aiJob({ status: 'queued', finishedAt: null });
    let s = state({ job: queued });
    s = analysisReducer(s, { type: 'status', job: { ...queued, status: 'running' }, at: AFTER });
    expect(s.job?.status).toBe('running');
    s = analysisReducer(s, { type: 'status', job: queued, at: BEFORE });
    expect(s.job?.status).toBe('running');
  });

  it('ignores a status event for a job older than the current one', () => {
    const current = aiJob({ id: '01a17e5e-aa56-7985-be46-bf5f1c7e7f31', status: 'queued' });
    const old = aiJob({ createdAt: '2026-11-12T09:00:00.000Z', status: 'failed' });
    const s = analysisReducer(state({ job: current }), { type: 'status', job: old, at: AFTER });
    expect(s.job).toBe(current);
  });

  it('keeps a newer job from an event when an older fetch answers', () => {
    const running = aiJob({ status: 'running' });
    const s = analysisReducer(state({ job: running, at: AFTER }), {
      type: 'loaded',
      latest: { enabled: true, job: aiJob({ status: 'queued' }), findings: [aiFinding()] },
      loadedAt: LOADED,
    });
    expect(s.job).toBe(running);
    expect(s.findings).toHaveLength(1);
  });

  it('does not let the POST answer undo a newer status', () => {
    const running = aiJob({ status: 'running' });
    const s = analysisReducer(state({ job: running }), {
      type: 'started',
      job: aiJob({ status: 'queued' }),
    });
    expect(s.job).toBe(running);
  });

  it('rolls an optimistic dismiss back', async () => {
    const finding = aiFinding();
    let s = state({ findings: [finding] });
    const dispatch = (action: Parameters<typeof analysisReducer>[1]) => {
      s = analysisReducer(s, action);
    };
    const rollback = vi.fn(() => dispatch({ type: 'unhide', id: finding.id }));
    let seenWhilePending: number | undefined;
    await optimistic({
      apply: () => dispatch({ type: 'hide', id: finding.id }),
      call: async () => {
        seenWhilePending = visibleFindings(s).length;
        return { ok: false as const, error: 'failed' };
      },
      commit: () => {},
      rollback,
    });
    expect(seenWhilePending).toBe(0);
    expect(rollback).toHaveBeenCalledWith('failed');
    expect(visibleFindings(s)).toEqual([finding]);
  });

  it('rolls optimistic feedback back to the previous finding', async () => {
    const finding = aiFinding({ myFeedback: false, feedback: { helpful: 2, notHelpful: 1 } });
    let s = state({ findings: [finding] });
    const dispatch = (action: Parameters<typeof analysisReducer>[1]) => {
      s = analysisReducer(s, action);
    };
    let pending: unknown;
    await optimistic({
      apply: () => dispatch({ type: 'finding', finding: withFeedback(finding, true) }),
      call: async () => {
        pending = s.findings[0];
        return { ok: false as const, error: 'failed' };
      },
      commit: () => {},
      rollback: () => dispatch({ type: 'finding', finding }),
    });
    expect(pending).toMatchObject({ myFeedback: true, feedback: { helpful: 3, notHelpful: 0 } });
    expect(s.findings[0]).toBe(finding);
  });

  it('commits the saved finding on success', async () => {
    const finding = aiFinding();
    const saved = { ...finding, myFeedback: true, feedback: { helpful: 5, notHelpful: 0 } };
    let s = state({ findings: [finding] });
    await optimistic({
      apply: () => {
        s = analysisReducer(s, { type: 'finding', finding: withFeedback(finding, true) });
      },
      call: async () => ({ ok: true as const, data: saved }),
      commit: (data) => {
        s = analysisReducer(s, { type: 'finding', finding: data });
      },
      rollback: () => {},
    });
    expect(s.findings[0]).toBe(saved);
  });

  it('drops hidden ids the server no longer returns', () => {
    const kept = aiFinding();
    const gone = aiFinding();
    const s = analysisReducer(
      state({ findings: [kept, gone], hidden: new Set([kept.id, gone.id]) }),
      {
        type: 'loaded',
        latest: { enabled: true, job: aiJob(), findings: [kept] },
        loadedAt: AFTER,
      },
    );
    expect([...s.hidden]).toEqual([kept.id]);
  });
});

describe('withFeedback', () => {
  it("moves, adds and removes the caller's vote", () => {
    const base = aiFinding({ myFeedback: null, feedback: { helpful: 1, notHelpful: 1 } });
    const up = withFeedback(base, true);
    expect(up).toMatchObject({ myFeedback: true, feedback: { helpful: 2, notHelpful: 1 } });
    expect(withFeedback(up, false)).toMatchObject({
      myFeedback: false,
      feedback: { helpful: 1, notHelpful: 2 },
    });
    expect(withFeedback(up, null)).toMatchObject({
      myFeedback: null,
      feedback: { helpful: 1, notHelpful: 1 },
    });
  });
});
