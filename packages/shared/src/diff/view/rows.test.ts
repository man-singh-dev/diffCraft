import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parsePatch } from '../parse-patch.js';
import type { DiffHunk, DiffLine } from '../schemas.js';
import {
  buildSplitRows,
  buildUnifiedRows,
  type SplitCell,
  type SplitRow,
  type UnifiedRow,
} from './rows.js';

const fixturesDir = new URL('../fixtures/', import.meta.url);

const fixtureHunks = (name: string): DiffHunk[] =>
  parsePatch(readFileSync(new URL(`${name}.patch`, fixturesDir), 'utf8')).files[0]!.hunks;

function hunksOf(...bodies: [header: string, lines: string[]][]): DiffHunk[] {
  const text = ['--- a/f', '+++ b/f', ...bodies.flatMap(([h, lines]) => [h, ...lines]), ''];
  return parsePatch(text.join('\n')).files[0]!.hunks;
}

const nl = (noNewlineAtEnd: boolean) => (noNewlineAtEnd ? ' ⏎̸' : '');

const unified = (rows: UnifiedRow[]) =>
  rows.map((row) => {
    if (row.kind === 'gap') return `gap ${row.hiddenLines}`;
    if (row.kind === 'hunk') return row.header;
    const sign = { context: ' ', add: '+', del: '-' }[row.type];
    return `${sign}${row.oldNumber ?? '.'} ${row.newNumber ?? '.'} ${row.content}${nl(row.noNewlineAtEnd)}`;
  });

const cell = (c: SplitCell | null) =>
  c
    ? `${{ context: ' ', add: '+', del: '-' }[c.type]}${c.number} ${c.content}${nl(c.noNewlineAtEnd)}`
    : '';

const split = (rows: SplitRow[]) =>
  rows.map((row) => {
    if (row.kind === 'gap') return `gap ${row.hiddenLines}`;
    if (row.kind === 'hunk') return row.header;
    return `${cell(row.left)} | ${cell(row.right)}`;
  });

describe('buildUnifiedRows / buildSplitRows', () => {
  it('simple modify', () => {
    const hunks = hunksOf(['@@ -1,3 +1,3 @@', [' a', '-b', '+B', ' c']]);
    expect(unified(buildUnifiedRows(hunks))).toEqual([
      '@@ -1,3 +1,3 @@',
      ' 1 1 a',
      '-2 . b',
      '+. 2 B',
      ' 3 3 c',
    ]);
    expect(split(buildSplitRows(hunks))).toEqual([
      '@@ -1,3 +1,3 @@',
      ' 1 a |  1 a',
      '-2 b | +2 B',
      ' 3 c |  3 c',
    ]);
  });

  it('3 deleted + 1 added: one pair, two leftover deletions', () => {
    const hunks = hunksOf(['@@ -1,3 +1,1 @@', ['-x1', '-x2', '-x3', '+y']]);
    expect(unified(buildUnifiedRows(hunks))).toEqual([
      '@@ -1,3 +1,1 @@',
      '-1 . x1',
      '-2 . x2',
      '-3 . x3',
      '+. 1 y',
    ]);
    expect(split(buildSplitRows(hunks))).toEqual([
      '@@ -1,3 +1,1 @@',
      '-1 x1 | +1 y',
      '-2 x2 | ',
      '-3 x3 | ',
    ]);
  });

  it('1 deleted + 3 added: one pair, two leftover additions', () => {
    const hunks = hunksOf(['@@ -1,1 +1,3 @@', ['-x', '+y1', '+y2', '+y3']]);
    expect(split(buildSplitRows(hunks))).toEqual([
      '@@ -1,1 +1,3 @@',
      '-1 x | +1 y1',
      ' | +2 y2',
      ' | +3 y3',
    ]);
  });

  it('several blocks in one hunk; an add run followed by a del run does not pair', () => {
    const hunks = hunksOf([
      '@@ -1,6 +1,5 @@',
      ['-a', '+A', ' k', '+n', '-d', ' k2', '-e', '-f', '+F'],
    ]);
    expect(split(buildSplitRows(hunks))).toEqual([
      '@@ -1,6 +1,5 @@',
      '-1 a | +1 A',
      ' 2 k |  2 k',
      ' | +3 n',
      '-3 d | ',
      ' 4 k2 |  4 k2',
      '-5 e | +5 F',
      '-6 f | ',
    ]);
    expect(unified(buildUnifiedRows(hunks)).slice(1)).toEqual(
      hunks[0]!.lines.map((l) => unified([{ kind: 'line', key: '', segments: [], ...l }])[0]),
    );
  });

  it('two hunks with a gap between them; no gap before a hunk at line 1 or after the last hunk', () => {
    const hunks = fixtureHunks('modified-two-hunks');
    const rows = unified(buildUnifiedRows(hunks));
    expect(rows[0]).toBe('@@ -1,6 +1,6 @@');
    expect(rows.filter((r) => r.startsWith('gap'))).toEqual(['gap 17']);
    expect(rows.indexOf('gap 17')).toBe(rows.indexOf('@@ -24,7 +24,8 @@ line 23') - 1);
    expect(rows.at(-1)).toBe(' 30 31 line 30');
    expect(split(buildSplitRows(hunks)).filter((r) => r.startsWith('gap'))).toEqual(['gap 17']);
  });

  it('gap before a first hunk that starts later in the file', () => {
    const hunks = hunksOf(['@@ -10,2 +10,2 @@', [' a', '-b', '+B']]);
    expect(unified(buildUnifiedRows(hunks)).slice(0, 2)).toEqual(['gap 9', '@@ -10,2 +10,2 @@']);
  });

  it('counts a zero-length old range from the line before it', () => {
    // "-3,0" inserts after old line 3, so old lines 2 and 3 are hidden between the hunks.
    const hunks = hunksOf(['@@ -1 +1 @@', ['-a', '+A']], ['@@ -3,0 +4,1 @@', ['+new']]);
    expect(unified(buildUnifiedRows(hunks))).toContain('gap 2');
  });

  it('added file', () => {
    const hunks = fixtureHunks('added');
    expect(unified(buildUnifiedRows(hunks))).toEqual([
      '@@ -0,0 +1,2 @@',
      '+. 1 export const greet = (name: string) =>',
      '+. 2   `Hello, ${name}!`;',
    ]);
    expect(split(buildSplitRows(hunks))).toEqual([
      '@@ -0,0 +1,2 @@',
      ' | +1 export const greet = (name: string) =>',
      ' | +2   `Hello, ${name}!`;',
    ]);
  });

  it('deleted file', () => {
    const hunks = fixtureHunks('deleted');
    expect(unified(buildUnifiedRows(hunks))).toEqual([
      '@@ -1,2 +0,0 @@',
      '-1 . export const greet = (name: string) =>',
      '-2 .   `Hello, ${name}!`;',
    ]);
    expect(split(buildSplitRows(hunks))).toEqual([
      '@@ -1,2 +0,0 @@',
      '-1 export const greet = (name: string) => | ',
      '-2   `Hello, ${name}!`; | ',
    ]);
  });

  it('keeps noNewlineAtEnd', () => {
    const hunks = fixtureHunks('no-newline');
    expect(unified(buildUnifiedRows(hunks)).slice(1)).toEqual([
      ' 1 1 first',
      '-2 . last ⏎̸',
      '+. 2 final ⏎̸',
    ]);
    expect(split(buildSplitRows(hunks)).slice(1)).toEqual([
      ' 1 first |  1 first',
      '-2 last ⏎̸ | +2 final ⏎̸',
    ]);
  });

  it.each(['binary', 'pure-rename', 'mode-only'])('%s file (no hunks): no rows', (name) => {
    expect(buildUnifiedRows(fixtureHunks(name))).toEqual([]);
    expect(buildSplitRows(fixtureHunks(name))).toEqual([]);
  });

  it('word segments on paired lines, whole-line segments otherwise', () => {
    const hunks = hunksOf(['@@ -1,3 +1,2 @@', [' same', '-let a = 1;', '-gone', '+let a = 2;']]);
    const lines = buildUnifiedRows(hunks).filter((r) => r.kind === 'line');
    expect(lines.map((l) => l.segments)).toEqual([
      [{ text: 'same', changed: false }],
      [
        { text: 'let a = ', changed: false },
        { text: '1', changed: true },
        { text: ';', changed: false },
      ],
      [{ text: 'gone', changed: true }],
      [
        { text: 'let a = ', changed: false },
        { text: '2', changed: true },
        { text: ';', changed: false },
      ],
    ]);
    const [, pair, leftover] = buildSplitRows(hunks).filter((r) => r.kind === 'line');
    expect(pair).toMatchObject({
      left: { segments: lines[1]!.segments },
      right: { segments: lines[3]!.segments },
    });
    expect(leftover).toMatchObject({ left: { segments: lines[2]!.segments }, right: null });
  });
});

describe('row invariants over every fixture', () => {
  const lineKey = (
    l: Pick<DiffLine, 'type' | 'oldNumber' | 'newNumber' | 'content' | 'noNewlineAtEnd'>,
  ) => JSON.stringify([l.type, l.oldNumber, l.newNumber, l.content, l.noNewlineAtEnd]);

  const fixtures = readdirSync(fixturesDir).filter((f) => f.endsWith('.patch'));
  const files = fixtures.flatMap((name) =>
    parsePatch(readFileSync(new URL(name, fixturesDir), 'utf8')).files.map(
      (file, i) => [`${name} #${i}`, file.hunks] as const,
    ),
  );

  it.each(files)('%s', (_name, hunks) => {
    const expected = hunks.flatMap((h) => h.lines.map(lineKey));

    const unifiedRows = buildUnifiedRows(hunks);
    expect(unifiedRows.filter((r) => r.kind === 'line').map(lineKey)).toEqual(expected);

    const splitRows = buildSplitRows(hunks);
    const fromSplit = splitRows.flatMap((row) => {
      if (row.kind !== 'line') return [];
      const { left, right } = row;
      if (left?.type === 'context') {
        expect(right).toMatchObject({ type: 'context', content: left.content });
        return [lineKey({ ...left, oldNumber: left.number, newNumber: right!.number })];
      }
      return [
        ...(left ? [lineKey({ ...left, oldNumber: left.number, newNumber: null })] : []),
        ...(right ? [lineKey({ ...right, oldNumber: null, newNumber: right.number })] : []),
      ];
    });
    expect([...fromSplit].sort()).toEqual([...expected].sort());

    for (const rows of [unifiedRows, splitRows]) {
      const keys = rows.map((r) => r.key);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });
});
