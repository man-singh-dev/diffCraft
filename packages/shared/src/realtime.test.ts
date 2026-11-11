import { describe, expect, it } from 'vitest';
import {
  PresenceEventSchema,
  ReviewChangedEventSchema,
  ReviewDeletedEventSchema,
  ReviewRoomEventSchemas,
  ThreadUpsertEventSchema,
} from './realtime.js';

const REVIEW = '01a17e5e-aa56-7985-be46-bf5f1c7e7fd0';
const ACTOR = '3f2b8c1e-5d4a-4e6b-9c7d-1a2b3c4d5e6f';
const THREAD = '01a17e5e-aa56-7985-be46-bf5f1c7e7fd1';
const AT = '2026-11-11T10:00:00.123Z';
const base = { reviewId: REVIEW, actorId: ACTOR, at: AT };

const thread = {
  id: THREAD,
  reviewId: REVIEW,
  anchor: null,
  status: 'open',
  resolvedBy: null,
  resolvedAt: null,
  createdBy: { id: ACTOR, displayName: 'Someone' },
  createdAt: AT,
  comments: [],
};

describe('review room event schemas', () => {
  it('has one schema per event', () => {
    expect(Object.keys(ReviewRoomEventSchemas).sort()).toEqual([
      'presence',
      'review:changed',
      'review:deleted',
      'thread:upsert',
    ]);
  });

  it('accepts valid payloads, including a null actor', () => {
    expect(ThreadUpsertEventSchema.safeParse({ ...base, thread }).success).toBe(true);
    expect(ReviewChangedEventSchema.safeParse({ ...base, reason: 'merged' }).success).toBe(true);
    expect(ReviewDeletedEventSchema.safeParse({ ...base, actorId: null }).success).toBe(true);
  });

  it.each([
    ['a non-uuid review id', { ...base, reviewId: 'nope' }],
    ['a missing actor', { reviewId: REVIEW, at: AT }],
    ['a non-ISO time', { ...base, at: 'yesterday' }],
  ])('rejects %s', (_, payload) => {
    expect(ReviewDeletedEventSchema.safeParse(payload).success).toBe(false);
  });

  it('rejects an unknown reason and a malformed thread', () => {
    expect(ReviewChangedEventSchema.safeParse({ ...base, reason: 'rules' }).success).toBe(false);
    expect(
      ThreadUpsertEventSchema.safeParse({ ...base, thread: { ...thread, status: 'gone' } }).success,
    ).toBe(false);
  });

  it('accepts a presence list and rejects a malformed or oversized one', () => {
    const viewer = { id: ACTOR, displayName: 'Asha' };
    const presence = { reviewId: REVIEW, viewers: [viewer], total: 1 };
    expect(PresenceEventSchema.safeParse(presence).success).toBe(true);
    expect(PresenceEventSchema.safeParse({ ...presence, total: -1 }).success).toBe(false);
    expect(PresenceEventSchema.safeParse({ ...presence, viewers: [{ id: 'x' }] }).success).toBe(
      false,
    );
    expect(
      PresenceEventSchema.safeParse({ ...presence, viewers: Array(51).fill(viewer), total: 51 })
        .success,
    ).toBe(false);
  });
});
