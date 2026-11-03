import { describe, expect, it } from 'vitest';
import type { Segment } from './diff-words.js';
import { mergePieces, type ColorToken, type Piece } from './merge-pieces.js';

const t = (text: string, color: string | null = null): ColorToken => ({ text, color });
const s = (text: string, changed = false): Segment => ({ text, changed });
const p = (text: string, color: string | null, changed = false): Piece => ({
  text,
  color,
  changed,
});

/** Runs mergePieces and checks that the pieces join back to the line. */
function merge(tokens: ColorToken[], segments: Segment[]): Piece[] {
  const pieces = mergePieces(tokens, segments);
  expect(pieces.map((x) => x.text).join('')).toBe(segments.map((x) => x.text).join(''));
  for (const piece of pieces) expect(piece.text).not.toBe('');
  return pieces;
}

describe('mergePieces', () => {
  it('a segment boundary in the middle of a token splits the token', () => {
    // "const total" with "tal" changed: the identifier token is cut in two.
    expect(
      merge([t('const', 'K'), t(' '), t('total', 'V')], [s('const to'), s('tal', true)]),
    ).toEqual([p('const', 'K'), p(' ', null), p('to', 'V'), p('tal', 'V', true)]);
  });

  it('a token boundary in the middle of a segment splits the segment', () => {
    expect(merge([t('a', 'X'), t('+', 'O'), t('b', 'X')], [s('a+b', true)])).toEqual([
      p('a', 'X', true),
      p('+', 'O', true),
      p('b', 'X', true),
    ]);
  });

  it('merges neighbours with the same color and flag', () => {
    expect(merge([t('foo', 'X'), t('bar', 'X'), t('baz', 'Y')], [s('fo'), s('obarbaz')])).toEqual([
      p('foobar', 'X'),
      p('baz', 'Y'),
    ]);
  });

  it('identical boundaries on both sides', () => {
    expect(merge([t('let', 'K'), t(' x', null)], [s('let', true), s(' x')])).toEqual([
      p('let', 'K', true),
      p(' x', null),
    ]);
  });

  it('ignores empty tokens and segments', () => {
    expect(merge([t(''), t('ab', 'X'), t('')], [s(''), s('a'), s('b', true)])).toEqual([
      p('a', 'X'),
      p('b', 'X', true),
    ]);
  });

  it('empty line: no pieces', () => {
    expect(merge([], [])).toEqual([]);
  });

  it('falls back to uncolored segments when the texts differ', () => {
    expect(merge([t('const a', 'K')], [s('const '), s('b', true)])).toEqual([
      p('const ', null),
      p('b', null, true),
    ]);
  });

  it('round trip with Unicode', () => {
    merge([t('"café 👍"', 'S'), t(';')], [s('"caf'), s('é 👍', true), s('";')]);
  });
});
