import type { Thread } from '@diffcraft/shared';
import { describe, expect, it } from 'vitest';
import {
  groupThreadsByKey,
  openLineThreads,
  splitCellTarget,
  targetKey,
  threadKey,
  unifiedRowKeys,
  unifiedRowTarget,
} from './thread-anchors.js';

const FILE = '3f2b8c1e-5d4a-4e6b-9c7d-1a2b3c4d5e6f';
const OTHER_FILE = '01a17e5e-aa56-7985-be46-bf5f1c7e7fd0';

let n = 0;
function thread(anchor: Thread['anchor'], status: Thread['status'] = 'open'): Thread {
  n += 1;
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    reviewId: FILE,
    anchor,
    status,
    resolvedBy: null,
    resolvedAt: status === 'resolved' ? '2026-11-05T10:00:00.000Z' : null,
    createdBy: null,
    createdAt: `2026-11-05T10:00:${String(n).padStart(2, '0')}.000Z`,
    comments: [],
  };
}
const at = (side: 'old' | 'new', line: number, fileId = FILE) => ({
  fileId,
  side,
  line,
  lineContent: 'x',
});

describe('threadKey', () => {
  it('differs by file, side and line', () => {
    const keys = new Set([
      threadKey(FILE, 'old', 3),
      threadKey(FILE, 'new', 3),
      threadKey(FILE, 'old', 4),
      threadKey(OTHER_FILE, 'old', 3),
    ]);
    expect(keys.size).toBe(4);
    expect(targetKey({ fileId: FILE, side: 'new', line: 3 })).toBe(threadKey(FILE, 'new', 3));
  });
});

describe('unifiedRowKeys', () => {
  it('a deleted line matches its old side only', () => {
    expect(unifiedRowKeys(FILE, { type: 'del', oldNumber: 7, newNumber: null })).toEqual([
      threadKey(FILE, 'old', 7),
    ]);
  });

  it('an added line matches its new side only', () => {
    expect(unifiedRowKeys(FILE, { type: 'add', oldNumber: null, newNumber: 8 })).toEqual([
      threadKey(FILE, 'new', 8),
    ]);
  });

  it('a context line matches both its old and its new line', () => {
    expect(unifiedRowKeys(FILE, { type: 'context', oldNumber: 10, newNumber: 12 })).toEqual([
      threadKey(FILE, 'old', 10),
      threadKey(FILE, 'new', 12),
    ]);
  });
});

describe('unifiedRowTarget (where "+" starts a thread)', () => {
  it('follows anchorForLine: deleted → old side, context and added → new side', () => {
    expect(unifiedRowTarget(FILE, { type: 'del', oldNumber: 7, newNumber: null })).toEqual({
      fileId: FILE,
      side: 'old',
      line: 7,
    });
    expect(unifiedRowTarget(FILE, { type: 'add', oldNumber: null, newNumber: 8 })).toEqual({
      fileId: FILE,
      side: 'new',
      line: 8,
    });
    expect(unifiedRowTarget(FILE, { type: 'context', oldNumber: 10, newNumber: 12 })).toEqual({
      fileId: FILE,
      side: 'new',
      line: 12,
    });
  });
});

describe('split cells', () => {
  it('each half is its own side, so a context line has a different key per half', () => {
    const left = splitCellTarget(FILE, 'old', 10);
    const right = splitCellTarget(FILE, 'new', 12);
    expect(targetKey(left)).toBe(threadKey(FILE, 'old', 10));
    expect(targetKey(right)).toBe(threadKey(FILE, 'new', 12));
  });
});

describe('groupThreadsByKey', () => {
  it('groups line threads by key in order and skips review-level threads', () => {
    const a = thread(at('new', 2));
    const b = thread(null);
    const c = thread(at('old', 2));
    const d = thread(at('new', 2));
    const e = thread(at('new', 2, OTHER_FILE));
    const groups = groupThreadsByKey([a, b, c, d, e]);

    expect([...groups.keys()]).toEqual([
      threadKey(FILE, 'new', 2),
      threadKey(FILE, 'old', 2),
      threadKey(OTHER_FILE, 'new', 2),
    ]);
    expect(groups.get(threadKey(FILE, 'new', 2))).toEqual([a, d]);
    expect(groups.get(threadKey(FILE, 'old', 2))).toEqual([c]);
  });

  it('a context row in the unified view finds threads from both sides', () => {
    const oldSide = thread(at('old', 10));
    const newSide = thread(at('new', 12));
    const groups = groupThreadsByKey([oldSide, newSide]);
    const keys = unifiedRowKeys(FILE, { type: 'context', oldNumber: 10, newNumber: 12 });
    expect(keys.flatMap((key) => groups.get(key) ?? [])).toEqual([oldSide, newSide]);
  });
});

describe('openLineThreads', () => {
  it('keeps open threads with an anchor', () => {
    const open = thread(at('new', 1));
    const resolved = thread(at('new', 2), 'resolved');
    const reviewLevel = thread(null);
    expect(openLineThreads([open, resolved, reviewLevel])).toEqual([open]);
  });
});
