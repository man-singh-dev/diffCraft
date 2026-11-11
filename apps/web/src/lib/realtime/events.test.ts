import type { Thread } from '@diffcraft/shared';
import { describe, expect, it } from 'vitest';
import { isNotOlder, mergeResync, parseRoomEvent, upsertThread } from './events';

const REVIEW = '01a17e5e-aa56-7985-be46-bf5f1c7e7f10';
const ACTOR = '01a17e5e-aa56-7985-be46-bf5f1c7e7f01';

function thread(id: string, status: Thread['status'] = 'open'): Thread {
  return {
    id,
    reviewId: REVIEW,
    anchor: null,
    status,
    resolvedBy: null,
    resolvedAt: null,
    createdBy: { id: ACTOR, displayName: 'Ada' },
    createdAt: '2026-11-11T09:00:00.000Z',
    comments: [],
  };
}
const A = '01a17e5e-aa56-7985-be46-bf5f1c7e7f21';
const B = '01a17e5e-aa56-7985-be46-bf5f1c7e7f22';
const C = '01a17e5e-aa56-7985-be46-bf5f1c7e7f23';

describe('isNotOlder (last writer wins by `at`)', () => {
  it('applies a newer or equal event, or one for an unknown thread, and skips an older one', () => {
    const applied = '2026-11-11T10:00:00.500Z';
    expect(isNotOlder('2026-11-11T10:00:00.501Z', applied)).toBe(true);
    expect(isNotOlder(applied, applied)).toBe(true);
    expect(isNotOlder('2026-11-11T10:00:00.499Z', applied)).toBe(false);
    expect(isNotOlder('2026-11-11T09:00:00.000Z', undefined)).toBe(true);
  });
});

describe('upsertThread', () => {
  it('replaces by id in place, or appends', () => {
    const list = [thread(A), thread(B)];
    expect(upsertThread(list, thread(A, 'resolved')).map((t) => [t.id, t.status])).toEqual([
      [A, 'resolved'],
      [B, 'open'],
    ]);
    expect(upsertThread(list, thread(C)).map((t) => t.id)).toEqual([A, B, C]);
  });
});

describe('mergeResync', () => {
  it('takes the refetched threads, except those changed by a newer event meanwhile', () => {
    const loadedAt = '2026-11-11T10:00:00.000Z';
    const current = [thread(A, 'resolved'), thread(B, 'resolved'), thread(C)];
    const appliedAt = new Map([
      [A, '2026-11-11T10:00:00.100Z'],
      [B, '2026-11-11T09:59:59.000Z'],
      [C, '2026-11-11T10:00:00.200Z'],
    ]);
    const fetched = [thread(A), thread(B)];

    const merged = mergeResync(current, appliedAt, fetched, loadedAt);
    expect(merged.threads.map((t) => [t.id, t.status])).toEqual([
      [A, 'resolved'],
      [B, 'open'],
      [C, 'open'],
    ]);
    expect(merged.appliedAt).toEqual(
      new Map([
        [A, '2026-11-11T10:00:00.100Z'],
        [B, loadedAt],
        [C, '2026-11-11T10:00:00.200Z'],
      ]),
    );
  });
});

describe('parseRoomEvent', () => {
  const base = { reviewId: REVIEW, actorId: ACTOR, at: '2026-11-11T10:00:00.000Z' };

  it('returns a valid event for this review', () => {
    expect(parseRoomEvent('review:changed', { ...base, reason: 'decision' }, REVIEW)).toEqual({
      ...base,
      reason: 'decision',
    });
  });

  it.each([
    ['another review', { ...base, reviewId: ACTOR, reason: 'decision' }],
    ['an unknown reason', { ...base, reason: 'rules' }],
    ['a bad timestamp', { ...base, at: 'now', reason: 'decision' }],
    ['no payload', undefined],
  ])('ignores %s', (_, payload) => {
    expect(parseRoomEvent('review:changed', payload, REVIEW)).toBeNull();
  });

  it('ignores everything before the room is joined', () => {
    expect(parseRoomEvent('review:deleted', base, null)).toBeNull();
  });
});
