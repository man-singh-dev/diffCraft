import type { DiffHunk, DiffLine } from '../schemas.ts';
import type { Segment } from './diff-words.ts';
import { pairHunkLines, type PairedLine } from './pairing.ts';

export interface HunkRow {
  kind: 'hunk';
  key: string;
  header: string;
  section: string | null;
}

/** Lines of the file that are not in the patch. */
export interface GapRow {
  kind: 'gap';
  key: string;
  hiddenLines: number;
}

export interface UnifiedLineRow {
  kind: 'line';
  key: string;
  type: DiffLine['type'];
  oldNumber: number | null;
  newNumber: number | null;
  content: string;
  noNewlineAtEnd: boolean;
  segments: Segment[];
}

export type UnifiedRow = HunkRow | GapRow | UnifiedLineRow;

export interface SplitCell {
  type: DiffLine['type'];
  number: number;
  content: string;
  noNewlineAtEnd: boolean;
  segments: Segment[];
}

export interface SplitLineRow {
  kind: 'line';
  key: string;
  left: SplitCell | null;
  right: SplitCell | null;
}

export type SplitRow = HunkRow | GapRow | SplitLineRow;

/** First line and end (exclusive) of the range a hunk covers on one side. */
function hunkRange(hunk: DiffHunk): { first: number; end: number } {
  // An added file has an empty old side (-0,0), so measure on the new side.
  const useNew = hunk.oldStart === 0 && hunk.oldLines === 0;
  const start = useNew ? hunk.newStart : hunk.oldStart;
  const count = useNew ? hunk.newLines : hunk.oldLines;
  // With a count of 0, start is the line *before* the hunk (e.g. "-5,0" inserts after line 5).
  const first = count === 0 ? start + 1 : start;
  return { first, end: first + count };
}

function gapBefore(hunks: DiffHunk[], index: number): GapRow | null {
  const hunk = hunks[index]!;
  const prev = hunks[index - 1];
  const hiddenLines = hunkRange(hunk).first - (prev ? hunkRange(prev).end : 1);
  return hiddenLines > 0 ? { kind: 'gap', key: `g${index}`, hiddenLines } : null;
}

function hunkRow(hunk: DiffHunk, index: number): HunkRow {
  return { kind: 'hunk', key: `h${index}`, header: hunk.header, section: hunk.section };
}

/** Gap and hunk header rows, then the hunk's own rows. */
function buildRows<T>(
  hunks: DiffHunk[],
  hunkRows: (hunk: DiffHunk, index: number) => T[],
): (HunkRow | GapRow | T)[] {
  const rows: (HunkRow | GapRow | T)[] = [];
  hunks.forEach((hunk, index) => {
    const gap = gapBefore(hunks, index);
    if (gap) rows.push(gap);
    rows.push(hunkRow(hunk, index), ...hunkRows(hunk, index));
  });
  return rows;
}

function unifiedLine({ line, segments }: PairedLine, hunkIndex: number): UnifiedLineRow {
  return {
    kind: 'line',
    key: `h${hunkIndex}-o${line.oldNumber ?? ''}-n${line.newNumber ?? ''}`,
    type: line.type,
    oldNumber: line.oldNumber,
    newNumber: line.newNumber,
    content: line.content,
    noNewlineAtEnd: line.noNewlineAtEnd,
    segments,
  };
}

/** Rows for a unified (one column) diff view. */
export function buildUnifiedRows(hunks: DiffHunk[]): UnifiedRow[] {
  return buildRows(hunks, (hunk, index) =>
    pairHunkLines(hunk).flatMap((block) =>
      block.kind === 'context'
        ? [unifiedLine(block.line, index)]
        : [...block.dels, ...block.adds].map((paired) => unifiedLine(paired, index)),
    ),
  );
}

function splitCell({ line, segments }: PairedLine, number: number | null): SplitCell {
  if (number === null)
    throw new Error(`diff line has no ${line.type === 'del' ? 'old' : 'new'} number`);
  return {
    type: line.type,
    number,
    content: line.content,
    noNewlineAtEnd: line.noNewlineAtEnd,
    segments,
  };
}

function splitLine(
  left: PairedLine | undefined,
  right: PairedLine | undefined,
  hunkIndex: number,
): SplitLineRow {
  const leftCell = left ? splitCell(left, left.line.oldNumber) : null;
  const rightCell = right ? splitCell(right, right.line.newNumber) : null;
  return {
    kind: 'line',
    key: `h${hunkIndex}-o${leftCell?.number ?? ''}-n${rightCell?.number ?? ''}`,
    left: leftCell,
    right: rightCell,
  };
}

/** Rows for a side-by-side diff view: old on the left, new on the right. */
export function buildSplitRows(hunks: DiffHunk[]): SplitRow[] {
  return buildRows(hunks, (hunk, index) =>
    pairHunkLines(hunk).flatMap((block) => {
      if (block.kind === 'context') return [splitLine(block.line, block.line, index)];
      const rows: SplitLineRow[] = [];
      for (let i = 0; i < Math.max(block.dels.length, block.adds.length); i++) {
        rows.push(splitLine(block.dels[i], block.adds[i], index));
      }
      return rows;
    }),
  );
}
