import type { AiFindingOutput, DiffLine } from '@diffcraft/shared';
import { describe, expect, it } from 'vitest';
import type { AnalyzedFile } from './context.js';
import { mapFindings } from './mapping.js';

const line = (
  type: DiffLine['type'],
  oldNumber: number | null,
  newNumber: number | null,
): DiffLine => ({ type, content: 'x', oldNumber, newNumber, noNewlineAtEnd: false });

// Two hunks: new lines 1-3 and 20-21; old lines 1-2 and 18-20.
const FILE: AnalyzedFile = {
  id: '0190a000-0000-7000-8000-000000000001',
  path: 'src/app.ts',
  oldPath: 'src/app.ts',
  newPath: 'src/app.ts',
  changeType: 'modified',
  hunks: [
    {
      header: '@@ -1,2 +1,3 @@',
      oldStart: 1,
      oldLines: 2,
      newStart: 1,
      newLines: 3,
      section: null,
      lines: [
        line('context', 1, 1),
        line('del', 2, null),
        line('add', null, 2),
        line('add', null, 3),
      ],
    },
    {
      header: '@@ -18,3 +20,2 @@',
      oldStart: 18,
      oldLines: 3,
      newStart: 20,
      newLines: 2,
      section: null,
      lines: [
        line('context', 18, 20),
        line('del', 19, null),
        line('del', 20, null),
        line('context', 21, 21),
      ],
    },
  ],
};

const RENAMED: AnalyzedFile = {
  ...FILE,
  id: '0190a000-0000-7000-8000-000000000002',
  path: 'src/new-name.ts',
  oldPath: 'src/old-name.ts',
  newPath: 'src/new-name.ts',
  changeType: 'renamed',
};

const finding = (overrides: Partial<AiFindingOutput>): AiFindingOutput => ({
  category: 'bug',
  severity: 'medium',
  title: 'Problem',
  explanation: 'Why it is a problem.',
  confidence: 0.7,
  file: 'src/app.ts',
  side: 'new',
  lineStart: 2,
  lineEnd: 3,
  ...overrides,
});

describe('mapFindings', () => {
  it('keeps findings whose range is inside one hunk and anchors them to the file', () => {
    const { mapped, dropped } = mapFindings(
      [finding({}), finding({ side: 'old', lineStart: 19, lineEnd: 20, suggestion: '' })],
      [FILE],
    );
    expect(dropped).toBe(0);
    expect(mapped).toEqual([
      expect.objectContaining({ reviewFileId: FILE.id, side: 'new', lineStart: 2, lineEnd: 3 }),
      expect.objectContaining({ side: 'old', lineStart: 19, lineEnd: 20, suggestion: null }),
    ]);
  });

  it('drops and counts findings on lines, files or ranges that are not in the diff', () => {
    const { mapped, dropped } = mapFindings(
      [
        finding({ lineStart: 10, lineEnd: 10 }),
        finding({ lineStart: 3, lineEnd: 20 }),
        finding({ side: 'new', lineStart: 19, lineEnd: 19 }),
        finding({ file: 'src/missing.ts' }),
        finding({ file: null }),
        finding({ lineStart: null }),
        finding({ lineStart: 3, lineEnd: 2 }),
        finding({}),
      ],
      [FILE],
    );
    expect(mapped).toHaveLength(1);
    expect(dropped).toBe(7);
  });

  it('infers the side and a single-line range when the model leaves them out', () => {
    const { mapped } = mapFindings(
      [
        finding({ side: null, lineStart: 2, lineEnd: null }),
        finding({ side: undefined, lineStart: 19, lineEnd: undefined }),
      ],
      [FILE],
    );
    expect(mapped.map((m) => [m.side, m.lineStart, m.lineEnd])).toEqual([
      ['new', 2, 2],
      ['old', 19, 19],
    ]);
  });

  it('matches paths with a/ b/ ./ prefixes and the old path of a rename', () => {
    const { mapped, dropped } = mapFindings(
      [
        finding({ file: 'b/src/app.ts' }),
        finding({ file: './src/app.ts' }),
        finding({ file: 'src/old-name.ts' }),
      ],
      [FILE, RENAMED],
    );
    expect(dropped).toBe(0);
    expect(mapped.map((m) => m.reviewFileId)).toEqual([FILE.id, FILE.id, RENAMED.id]);
  });
});
