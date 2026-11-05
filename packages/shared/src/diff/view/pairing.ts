import type { DiffHunk, DiffLine } from '../schemas.ts';
import { diffWords, wholeLine, type Segment } from './diff-words.ts';

export interface PairedLine {
  line: DiffLine;
  segments: Segment[];
}

export type HunkBlock =
  | { kind: 'context'; line: PairedLine }
  | {
      kind: 'change';
      dels: PairedLine[];
      adds: PairedLine[];
      pairs: number;
    };

export function pairHunkLines(hunk: DiffHunk): HunkBlock[] {
  const blocks: HunkBlock[] = [];
  let dels: DiffLine[] = [];
  let adds: DiffLine[] = [];

  const flush = () => {
    if (dels.length === 0 && adds.length === 0) return;
    const pairs = Math.min(dels.length, adds.length);
    const delLines = dels.map((line) => ({ line, segments: wholeLine(line.content, true) }));
    const addLines = adds.map((line) => ({ line, segments: wholeLine(line.content, true) }));
    for (let i = 0; i < pairs; i++) {
      const del = delLines[i]!;
      const add = addLines[i]!;
      const words = diffWords(del.line.content, add.line.content);
      del.segments = words.old;
      add.segments = words.new;
    }
    blocks.push({ kind: 'change', dels: delLines, adds: addLines, pairs });
    dels = [];
    adds = [];
  };

  for (const line of hunk.lines) {
    if (line.type === 'context') {
      flush();
      blocks.push({ kind: 'context', line: { line, segments: wholeLine(line.content, false) } });
    } else if (line.type === 'del') {
      // A del after adds starts a new block: dels must come first to pair.
      if (adds.length > 0) flush();
      dels.push(line);
    } else {
      adds.push(line);
    }
  }
  flush();
  return blocks;
}
