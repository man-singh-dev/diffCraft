import { describe, expect, it } from 'vitest';
import {
  diffWords,
  tokenize,
  WORD_DIFF_MAX_CHARS,
  WORD_DIFF_MAX_TOKENS,
  type Segment,
  type WordDiff,
} from './diff-words.js';

const join = (segments: Segment[]) => segments.map((s) => s.text).join('');

function diff(oldText: string, newText: string): WordDiff {
  const result = diffWords(oldText, newText);
  expect(join(result.old)).toBe(oldText);
  expect(join(result.new)).toBe(newText);
  for (const side of [result.old, result.new]) {
    for (const [i, segment] of side.entries()) {
      expect(segment.text).not.toBe('');
      if (i > 0) expect(segment.changed).not.toBe(side[i - 1]!.changed);
    }
  }
  return result;
}

const s = (text: string, changed = false): Segment => ({ text, changed });

describe('tokenize', () => {
  it('splits words, whitespace runs and single other characters', () => {
    expect(tokenize('foo_1(bar,  baz);')).toEqual([
      'foo_1',
      '(',
      'bar',
      ',',
      '  ',
      'baz',
      ')',
      ';',
    ]);
  });

  it('keeps Unicode letters and combining accents in words, and emoji whole', () => {
    expect(tokenize('café café 👍!')).toEqual(['café', ' ', 'café', ' ', '👍', '!']);
  });
});

describe('diffWords', () => {
  it('identical lines: one unchanged segment', () => {
    expect(diff('const a = 1;', 'const a = 1;')).toEqual({
      old: [s('const a = 1;')],
      new: [s('const a = 1;')],
    });
  });

  it('empty lines: no segments', () => {
    expect(diff('', '')).toEqual({ old: [], new: [] });
  });

  it('one changed word', () => {
    expect(diff('const total = price * qty;', 'const total = cost * qty;')).toEqual({
      old: [s('const total = '), s('price', true), s(' * qty;')],
      new: [s('const total = '), s('cost', true), s(' * qty;')],
    });
  });

  it('words added at the start and the end', () => {
    expect(diff('return value;', 'export return value; // done')).toEqual({
      old: [s('return value;')],
      new: [s('export ', true), s('return value;'), s(' // done', true)],
    });
  });

  it('whitespace-only change', () => {
    expect(diff('if (a &&  b) {', 'if (a && b) {')).toEqual({
      old: [s('if (a &&'), s('  ', true), s('b) {')],
      new: [s('if (a &&'), s(' ', true), s('b) {')],
    });
  });

  it('completely different lines: whole line changed', () => {
    expect(diff('import { readFile } from "fs";', 'return 42;')).toEqual({
      old: [s('import { readFile } from "fs";', true)],
      new: [s('return 42;', true)],
    });
  });

  it('one side empty: whole line changed', () => {
    expect(diff('', 'new text')).toEqual({ old: [], new: [s('new text', true)] });
  });

  it('too few characters in common: whole line changed', () => {
    // Only "a" and the spaces match: well under 40% of the characters.
    expect(diff('alpha a beta', 'gamma a delta')).toEqual({
      old: [s('alpha a beta', true)],
      new: [s('gamma a delta', true)],
    });
  });

  it('over the token limit: whole line changed', () => {
    const tokens = Math.ceil(WORD_DIFF_MAX_TOKENS / 2) + 1;
    const oldText = 'x '.repeat(tokens);
    const newText = `${'x '.repeat(tokens - 1)}y `;
    expect(tokenize(oldText).length).toBeGreaterThan(WORD_DIFF_MAX_TOKENS);
    expect(diff(oldText, newText)).toEqual({ old: [s(oldText, true)], new: [s(newText, true)] });
  });

  it('over the character limit: whole line changed', () => {
    const oldText = `a ${'w'.repeat(WORD_DIFF_MAX_CHARS)}`;
    const newText = `b ${'w'.repeat(WORD_DIFF_MAX_CHARS)}`;
    expect(diff(oldText, newText)).toEqual({ old: [s(oldText, true)], new: [s(newText, true)] });
  });

  it('Unicode words and emoji', () => {
    expect(diff('un café ☕ chaud', 'un thé 🍵 chaud')).toEqual({
      old: [s('un '), s('café', true), s(' '), s('☕', true), s(' chaud')],
      new: [s('un '), s('thé', true), s(' '), s('🍵', true), s(' chaud')],
    });
    expect(diff('ok 👍 done', 'ok 👎 done')).toEqual({
      old: [s('ok '), s('👍', true), s(' done')],
      new: [s('ok '), s('👎', true), s(' done')],
    });
  });

  it.each([
    ['', ''],
    ['a', ''],
    ['  leading and trailing  ', ' leading  trailing '],
    ['tabs\tand\tspaces', 'tabs and spaces'],
    ['f(a, b, c)', 'f(a, c, b, d)'],
    ['👨‍👩‍👧 family', '👨‍👩‍👦 family'],
    ['café au lait', 'café au lait'],
    ['a\u0000b', 'a\u0000c'],
    ['x'.repeat(WORD_DIFF_MAX_CHARS + 1), 'y'],
  ])('joining the segments gives back the text: %j → %j', (oldText, newText) => {
    diff(oldText, newText);
    diff(newText, oldText);
  });
});
