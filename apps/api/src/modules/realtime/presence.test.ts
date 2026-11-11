import { describe, expect, it } from 'vitest';
import { summarizeViewers } from './presence.js';

const REVIEW = '01a17e5e-aa56-7985-be46-bf5f1c7e7f10';
const id = (n: number) => `01a17e5e-aa56-7985-be46-${String(n).padStart(12, '0')}`;

describe('summarizeViewers', () => {
  it('counts a user once and sorts by display name', () => {
    const sockets = [
      { data: { userId: id(1), displayName: 'Ravi' } },
      { data: { userId: id(2), displayName: 'Asha' } },
      { data: { userId: id(1), displayName: 'Ravi' } },
    ];
    expect(summarizeViewers(REVIEW, sockets)).toEqual({
      reviewId: REVIEW,
      viewers: [
        { id: id(2), displayName: 'Asha' },
        { id: id(1), displayName: 'Ravi' },
      ],
      total: 2,
    });
  });

  it('caps the list at 50 but reports the real total', () => {
    const sockets = Array.from({ length: 60 }, (_, n) => ({
      data: { userId: id(n), displayName: `User ${String(n).padStart(2, '0')}` },
    }));
    const { viewers, total } = summarizeViewers(REVIEW, sockets);
    expect(viewers).toHaveLength(50);
    expect(viewers[0]).toEqual({ id: id(0), displayName: 'User 00' });
    expect(total).toBe(60);
  });

  it('skips sockets without a user', () => {
    expect(summarizeViewers(REVIEW, [{ data: {} }]).total).toBe(0);
  });
});
