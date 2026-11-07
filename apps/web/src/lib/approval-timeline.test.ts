import type { ReviewDecision, ReviewEvent } from '@diffcraft/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { describeEntry, mergeTimeline, type TimelineEntry } from './approval-timeline.js';

const REVIEW = '01a17e5e-aa56-7985-be46-bf5f1c7e7f00';
const ASHA = { id: '01a17e5e-aa56-7985-be46-bf5f1c7e7f01', displayName: 'Asha' };
const RAVI = { id: '01a17e5e-aa56-7985-be46-bf5f1c7e7f02', displayName: 'Ravi' };

const at = (second: number) => new Date(Date.UTC(2026, 10, 5, 10, 0, second)).toISOString();
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function event(
  id: number,
  second: number,
  type: ReviewEvent['type'],
  actor: ReviewEvent['actor'] = ASHA,
  data: ReviewEvent['data'] = {},
): ReviewEvent {
  return { id: uuid(id), reviewId: REVIEW, actor, type, data, createdAt: at(second) };
}

function decision(
  id: number,
  second: number,
  kind: ReviewDecision['decision'] = 'approve',
  reviewer: ReviewDecision['reviewer'] = RAVI,
  body: string | null = null,
): ReviewDecision {
  return { id: uuid(id), reviewId: REVIEW, reviewer, decision: kind, body, createdAt: at(second) };
}

const ids = (entries: TimelineEntry[]) =>
  entries.map((e) => `${e.kind[0]}${Number(e.id.slice(-12))}`);

afterEach(() => {
  vi.restoreAllMocks();
});

describe('mergeTimeline', () => {
  it('interleaves events and decisions by time and skips decision events', () => {
    const events = [
      event(1, 1, 'reviewer_assigned', ASHA, { userId: RAVI.id }),
      event(3, 3, 'decision', RAVI, { decisionId: uuid(2) }),
      event(5, 5, 'closed'),
      event(7, 7, 'reopened'),
    ];
    const decisions = [decision(2, 3, 'request_changes'), decision(6, 6)];
    expect(ids(mergeTimeline(events, decisions))).toEqual(['e1', 'd2', 'e5', 'd6', 'e7']);
  });

  it('orders entries at the same time by id', () => {
    const events = [event(2, 4, 'closed'), event(5, 4, 'reopened')];
    const decisions = [decision(1, 4), decision(3, 4), decision(9, 4)];
    expect(ids(mergeTimeline(events, decisions))).toEqual(['d1', 'e2', 'd3', 'e5', 'd9']);
  });

  it('handles empty lists', () => {
    expect(mergeTimeline([], [])).toEqual([]);
    expect(ids(mergeTimeline([event(1, 1, 'merged')], []))).toEqual(['e1']);
    expect(ids(mergeTimeline([], [decision(1, 1)]))).toEqual(['d1']);
  });

  it('merges two long lists in one pass, without sorting', () => {
    const n = 50_000;
    const events = Array.from({ length: n }, (_, i) => event(2 * i, i, 'closed'));
    const decisions = Array.from({ length: n }, (_, i) => decision(2 * i + 1, i));
    const sort = vi.spyOn(Array.prototype, 'sort');

    const merged = mergeTimeline(events, decisions);

    expect(sort).not.toHaveBeenCalled();
    expect(merged).toHaveLength(2 * n);
    const outOfOrder = merged.findIndex(
      (b, i) =>
        i > 0 &&
        !(
          merged[i - 1]!.createdAt < b.createdAt ||
          (merged[i - 1]!.createdAt === b.createdAt && merged[i - 1]!.id < b.id)
        ),
    );
    expect(outOfOrder).toBe(-1);
  });
});

describe('describeEntry', () => {
  const names = new Map([
    [ASHA.id, ASHA.displayName],
    [RAVI.id, RAVI.displayName],
  ]);
  const describe1 = (e: ReviewEvent) =>
    describeEntry({ kind: 'event', id: e.id, createdAt: e.createdAt, event: e }, names);
  const describeDecision = (d: ReviewDecision) =>
    describeEntry({ kind: 'decision', id: d.id, createdAt: d.createdAt, decision: d }, names);

  it('words each kind of entry', () => {
    expect(describe1(event(1, 1, 'reviewer_assigned', ASHA, { userId: RAVI.id }))).toBe(
      'Asha assigned Ravi',
    );
    expect(describe1(event(1, 1, 'reviewer_removed', ASHA, { userId: RAVI.id }))).toBe(
      'Asha removed Ravi',
    );
    expect(describe1(event(1, 1, 'reviewer_removed', RAVI, { userId: RAVI.id }))).toBe(
      'Ravi removed themselves',
    );
    expect(describe1(event(1, 1, 'closed'))).toBe('Asha closed');
    expect(describe1(event(1, 1, 'reopened'))).toBe('Asha reopened');
    expect(describe1(event(1, 1, 'merged'))).toBe('Asha merged');
    expect(describeDecision(decision(1, 1, 'approve'))).toBe('Ravi approved');
    expect(describeDecision(decision(1, 1, 'request_changes'))).toBe('Ravi requested changes');
  });

  it('names deleted users "Deleted user"', () => {
    expect(describe1(event(1, 1, 'merged', null))).toBe('Deleted user merged');
    expect(describeDecision(decision(1, 1, 'approve', null))).toBe('Deleted user approved');
    expect(describe1(event(1, 1, 'reviewer_assigned', null, { userId: RAVI.id }))).toBe(
      'Deleted user assigned Ravi',
    );
  });

  it('falls back for someone no longer in the workspace', () => {
    expect(describe1(event(1, 1, 'reviewer_assigned', ASHA, { userId: uuid(99) }))).toBe(
      'Asha assigned a former member',
    );
    expect(describe1(event(1, 1, 'reviewer_assigned', ASHA, { userId: 42 }))).toBe(
      'Asha assigned a former member',
    );
  });
});
