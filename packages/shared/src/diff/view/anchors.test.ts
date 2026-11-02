import { describe, expect, it } from 'vitest';
import type { DiffLine } from '../schemas.js';
import { anchorForLine, lineAnchor, parseLineAnchor } from './anchors.js';

const fileId = '3f2b8c1e-5d4a-4e6b-9c7d-1a2b3c4d5e6f';

const line = (type: DiffLine['type'], oldNumber: number | null, newNumber: number | null) => ({
  type,
  content: 'x',
  oldNumber,
  newNumber,
  noNewlineAtEnd: false,
});

describe('line anchors', () => {
  it('formats the old side with L and the new side with R', () => {
    expect(lineAnchor(fileId, 'old', 12)).toBe(`f-${fileId}-L12`);
    expect(lineAnchor(fileId, 'new', 12)).toBe(`f-${fileId}-R12`);
  });

  it.each([
    ['old', 1],
    ['new', 12],
    ['new', 2_147_483_647],
  ] as const)('round trip: %s %d', (side, number) => {
    expect(parseLineAnchor(lineAnchor(fileId, side, number))).toEqual({ fileId, side, number });
  });

  it.each([
    '',
    `f-${fileId}`,
    `f-${fileId}-L`,
    `f-${fileId}-L0`,
    `f-${fileId}-L012`,
    `f-${fileId}-L-1`,
    `f-${fileId}-L1.5`,
    `f-${fileId}-X12`,
    `f-${fileId}-l12`,
    `f-${fileId}-L2147483648`,
    `f-${fileId}-L99999999999`,
    `f-${fileId}-L12 `,
    ` f-${fileId}-L12`,
    `g-${fileId}-L12`,
    'f-not-a-uuid-L12',
    'f-------------------------------------L12',
    'f-3f2b8c1e5d4a4e6b9c7d1a2b3c4d5e6f0000-L12',
    'f-3f2b8c1e-5d4a-4e6b-9c7d-1a2b3c4d5e6g-L12',
  ])('rejects %j', (anchor) => {
    expect(parseLineAnchor(anchor)).toBeNull();
  });

  it('anchors deleted lines on the old side, context and added lines on the new side', () => {
    expect(anchorForLine(fileId, line('del', 7, null))).toBe(`f-${fileId}-L7`);
    expect(anchorForLine(fileId, line('add', null, 8))).toBe(`f-${fileId}-R8`);
    expect(anchorForLine(fileId, line('context', 9, 10))).toBe(`f-${fileId}-R10`);
  });
});
