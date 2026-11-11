import { describe, expect, it } from 'vitest';
import type { PresenceEvent } from '@diffcraft/shared';
import { describeViewers, newerPresence } from './presence';

const ME = '01a17e5e-aa56-7985-be46-bf5f1c7e7f01';
const id = (n: number) => `01a17e5e-aa56-7985-be46-${String(n).padStart(12, '0')}`;
const viewer = (n: number, displayName: string) => ({ id: id(n), displayName });
const me = { id: ME, displayName: 'Me' };

describe('describeViewers', () => {
  it('puts you first as "You", whatever the sort order', () => {
    const result = describeViewers(
      { viewers: [viewer(1, 'Asha'), me, viewer(2, 'Ravi')], total: 3 },
      ME,
    );
    expect(result).toEqual({
      label: 'You, Asha, Ravi viewing',
      description: 'Viewing this review: you, Asha and Ravi.',
    });
  });

  it('says when you are alone', () => {
    expect(describeViewers({ viewers: [me], total: 1 }, ME).label).toBe('Only you viewing');
  });

  it('pairs you with one other viewer', () => {
    expect(describeViewers({ viewers: [me, viewer(1, 'Asha')], total: 2 }, ME)).toEqual({
      label: 'You, Asha viewing',
      description: 'Viewing this review: you and Asha.',
    });
  });

  it('names three people at most, then "+N more"', () => {
    const viewers = [viewer(1, 'Asha'), viewer(2, 'Ben'), me, viewer(3, 'Cy'), viewer(4, 'Dev')];
    expect(describeViewers({ viewers, total: 5 }, ME).label).toBe('You, Asha, Ben +2 more viewing');
  });

  it('counts each person once', () => {
    const viewers = [viewer(1, 'Asha'), viewer(1, 'Asha'), me, me];
    expect(describeViewers({ viewers, total: 2 }, ME).label).toBe('You, Asha viewing');
  });

  it('counts viewers beyond the capped list, assuming you are among them if not listed', () => {
    const viewers = [viewer(1, 'Asha'), viewer(2, 'Ben')];
    expect(describeViewers({ viewers, total: 10 }, ME)).toEqual({
      label: 'You, Asha, Ben +7 more viewing',
      description: 'Viewing this review: you, Asha, Ben and 7 more.',
    });
  });
});

describe('newerPresence', () => {
  const at = (second: number) => `2026-11-12T10:00:${String(second).padStart(2, '0')}.000Z`;
  const event = (second: number, total: number): PresenceEvent => ({
    reviewId: '01a17e5e-aa56-7985-be46-bf5f1c7e7f10',
    at: at(second),
    viewers: [],
    total,
  });

  it('takes the first event and any newer or equally recent one', () => {
    expect(newerPresence(null, event(5, 1))).toEqual(event(5, 1));
    expect(newerPresence(event(5, 1), event(6, 2))).toEqual(event(6, 2));
    expect(newerPresence(event(5, 1), event(5, 3))).toEqual(event(5, 3));
  });

  it('ignores an event older than the one shown', () => {
    const shown = event(6, 2);
    expect(newerPresence(shown, event(5, 1))).toBe(shown);
  });
});
