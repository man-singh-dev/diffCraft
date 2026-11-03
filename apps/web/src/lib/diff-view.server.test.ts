import { readFileSync } from 'node:fs';
import { parsePatch, type Piece } from '@diffcraft/shared';
import { describe, expect, it, vi } from 'vitest';

// server-only throws outside a React Server Components build.
vi.mock('server-only', () => ({}));

const { highlightedSplitRows, highlightedUnifiedRows } = await import('./diff-view.server.js');

const join = (pieces: Piece[]) => pieces.map((p) => p.text).join('');

const patch = [
  '--- a/src/price.ts',
  '+++ b/src/price.ts',
  '@@ -1,5 +1,5 @@',
  ' // Prices are in cents.',
  '-export const total = (price: number) => price * 2;',
  '-const unused = 1;',
  '+export const total = (cost: number) => cost * 2;',
  ' /* a block',
  '+   comment */',
  ' export {};',
  '',
].join('\n');
const hunks = parsePatch(patch).files[0]!.hunks;

describe('highlightedUnifiedRows', () => {
  it('pieces join back to each line and carry both colors and word changes', async () => {
    const rows = await highlightedUnifiedRows('src/price.ts', hunks);
    const lines = rows.filter((r) => r.kind === 'line');
    expect(lines).toHaveLength(hunks[0]!.lines.length);
    for (const line of lines) expect(join(line.pieces)).toBe(line.content);

    const del = lines.find((l) => l.type === 'del' && l.oldNumber === 2)!;
    const add = lines.find((l) => l.type === 'add')!;
    expect(del.pieces.filter((p) => p.changed).map((p) => p.text)).toEqual(['price', 'price']);
    expect(add.pieces.filter((p) => p.changed).map((p) => p.text)).toEqual(['cost', 'cost']);
    expect(add.pieces.some((p) => p.text === 'export' && p.color !== null && !p.changed)).toBe(
      true,
    );

    // Unpaired deleted line: the whole line is changed, but still colored.
    const unused = lines.find((l) => l.oldNumber === 3)!;
    expect(unused.pieces.every((p) => p.changed)).toBe(true);
    expect(unused.pieces.some((p) => p.color !== null)).toBe(true);

    // The context line after the added "comment */" is code again on the new side.
    const exportLine = lines.at(-1)!;
    const commentColor = lines[0]!.pieces[0]!.color;
    expect(exportLine.pieces.find((p) => p.text.startsWith('export'))?.color).not.toBe(
      commentColor,
    );
  });

  it('unknown language: uncolored pieces that still mark word changes', async () => {
    const rows = await highlightedUnifiedRows('notes.txt', hunks);
    const lines = rows.filter((r) => r.kind === 'line');
    for (const line of lines) {
      expect(join(line.pieces)).toBe(line.content);
      expect(line.pieces.every((p) => p.color === null)).toBe(true);
    }
    expect(lines.some((l) => l.pieces.some((p) => p.changed))).toBe(true);
  });
});

describe('highlightedSplitRows', () => {
  it('every cell has pieces that join back to its content', async () => {
    const rows = await highlightedSplitRows('src/price.ts', hunks);
    const cells = rows.flatMap((r) => (r.kind === 'line' ? [r.left, r.right] : []));
    // 3 context rows × 2 cells, one del/add pair, one leftover del, one leftover add.
    expect(cells.filter((c) => c !== null)).toHaveLength(10);
    for (const cell of cells) if (cell) expect(join(cell.pieces)).toBe(cell.content);
  });

  it('a context row has the same pieces on both sides (taken from the new side)', async () => {
    const rows = await highlightedSplitRows('src/price.ts', hunks);
    for (const row of rows) {
      if (row.kind === 'line' && row.left?.type === 'context')
        expect(row.left.pieces).toEqual(row.right!.pieces);
    }
  });

  it('works across fixtures with several hunks and gaps', async () => {
    const fixture = readFileSync(
      new URL(
        '../../../../packages/shared/src/diff/fixtures/modified-two-hunks.patch',
        import.meta.url,
      ),
      'utf8',
    );
    const file = parsePatch(fixture).files[0]!;
    const rows = await highlightedSplitRows(file.newPath!, file.hunks);
    expect(rows.filter((r) => r.kind === 'gap')).toHaveLength(1);
    for (const row of rows) {
      if (row.kind !== 'line') continue;
      for (const cell of [row.left, row.right])
        if (cell) expect(join(cell.pieces)).toBe(cell.content);
    }
  });
});
