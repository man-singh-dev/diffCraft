import 'server-only';

import {
  buildSplitRows,
  buildUnifiedRows,
  mergePieces,
  type DiffHunk,
  type GapRow,
  type HunkRow,
  type Piece,
  type SplitCell,
  type SplitLineRow,
  type UnifiedLineRow,
} from '@diffcraft/shared';
import { highlightHunks, lineTokens, type HunkTokens } from './highlight.server';

export type HighlightedUnifiedLineRow = UnifiedLineRow & { pieces: Piece[] };
export type HighlightedUnifiedRow = HunkRow | GapRow | HighlightedUnifiedLineRow;

export type HighlightedSplitCell = SplitCell & { pieces: Piece[] };
export type HighlightedSplitLineRow = Omit<SplitLineRow, 'left' | 'right'> & {
  left: HighlightedSplitCell | null;
  right: HighlightedSplitCell | null;
};
export type HighlightedSplitRow = HunkRow | GapRow | HighlightedSplitLineRow;

function cellPieces(
  hunkTokens: HunkTokens | undefined,
  cell: SplitCell,
  side: 'old' | 'new',
  number: number,
): HighlightedSplitCell {
  const tokens = lineTokens(hunkTokens, side, number, cell.content);
  return { ...cell, pieces: mergePieces(tokens, cell.segments) };
}

export async function highlightedUnifiedRows(
  path: string,
  hunks: DiffHunk[],
): Promise<HighlightedUnifiedRow[]> {
  const tokens = await highlightHunks(path, hunks);
  let hunkIndex = -1;
  return buildUnifiedRows(hunks).map((row) => {
    if (row.kind === 'hunk') hunkIndex++;
    if (row.kind !== 'line') return row;
    const side = row.type === 'del' ? 'old' : 'new';
    const number = side === 'old' ? row.oldNumber : row.newNumber;
    const lineTokensOfRow = lineTokens(tokens[hunkIndex], side, number, row.content);
    return { ...row, pieces: mergePieces(lineTokensOfRow, row.segments) };
  });
}

export async function highlightedSplitRows(
  path: string,
  hunks: DiffHunk[],
): Promise<HighlightedSplitRow[]> {
  const tokens = await highlightHunks(path, hunks);
  let hunkIndex = -1;
  return buildSplitRows(hunks).map((row) => {
    if (row.kind === 'hunk') hunkIndex++;
    if (row.kind !== 'line') return row;
    const hunkTokens = tokens[hunkIndex];
    const { left, right } = row;
    return {
      ...row,
      // A context line's left cell takes its tokens from the new side, like the unified view.
      left:
        left &&
        (left.type === 'context' && right
          ? cellPieces(hunkTokens, left, 'new', right.number)
          : cellPieces(hunkTokens, left, 'old', left.number)),
      right: right && cellPieces(hunkTokens, right, 'new', right.number),
    };
  });
}

export type DiffRows =
  | { view: 'unified'; rows: HighlightedUnifiedRow[] }
  | { view: 'split'; rows: HighlightedSplitRow[] };

export async function highlightedRows(
  path: string,
  hunks: DiffHunk[],
  view: 'unified' | 'split',
): Promise<DiffRows> {
  return view === 'split'
    ? { view, rows: await highlightedSplitRows(path, hunks) }
    : { view, rows: await highlightedUnifiedRows(path, hunks) };
}
