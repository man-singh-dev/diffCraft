import { describe, expect, it } from 'vitest';
import {
  EAGER_FILE_COUNT,
  EAGER_MAX_CHANGED_LINES,
  eagerFileIds,
  filesPageHref,
  isDiffView,
  parseDiffView,
  parseHashTarget,
} from './diff-params.js';

const WORKSPACE = '3f2b8c1e-5d4a-4e6b-9c7d-1a2b3c4d5e6f';
const FILE = '01a17e5e-aa56-7985-be46-bf5f1c7e7fd0';

describe('parseDiffView', () => {
  it.each([
    [{ view: 'split' }, 'split'],
    [{ view: 'unified' }, 'unified'],
    [{}, 'unified'],
    [{ view: 'SPLIT' }, 'unified'],
    [{ view: ['split', 'split'] }, 'unified'],
    [{ view: '' }, 'unified'],
  ])('%j → %s', (searchParams, view) => {
    expect(parseDiffView(searchParams)).toBe(view);
  });

  it('isDiffView accepts only the two views', () => {
    expect(isDiffView('split')).toBe(true);
    expect(isDiffView('unified')).toBe(true);
    for (const value of ['Split', '', null, undefined, 1, ['split']])
      expect(isDiffView(value)).toBe(false);
  });
});

describe('filesPageHref', () => {
  const base = `/workspaces/${WORKSPACE}/reviews/7/files`;

  it('sets ?view=split for split and drops it for unified', () => {
    expect(filesPageHref(WORKSPACE, 7, {}, 'split')).toBe(`${base}?view=split`);
    expect(filesPageHref(WORKSPACE, 7, { view: 'split' }, 'unified')).toBe(base);
  });

  it('keeps the other parameters, including repeated ones', () => {
    expect(filesPageHref(WORKSPACE, '7', { view: 'unified', a: '1', b: ['x', 'y'] }, 'split')).toBe(
      `${base}?a=1&b=x&b=y&view=split`,
    );
  });
});

describe('eagerFileIds', () => {
  const file = (id: string, additions: number, deletions = 0, isBinary = false) => ({
    id,
    additions,
    deletions,
    isBinary,
  });

  it(`takes the first ${EAGER_FILE_COUNT} small files with changes`, () => {
    const files = [
      file('big', EAGER_MAX_CHANGED_LINES, 1),
      file('a', 1),
      file('binary', 0, 0, true),
      file('rename', 0),
      file('b', EAGER_MAX_CHANGED_LINES - 10, 10),
      file('c', 0, 3),
      file('d', 2, 2),
      file('e', 5),
      file('f', 1),
    ];
    expect([...eagerFileIds(files)]).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('no files: none eager', () => {
    expect(eagerFileIds([]).size).toBe(0);
  });
});

describe('parseHashTarget', () => {
  it('a file section', () => {
    expect(parseHashTarget(`#file-${FILE}`)).toEqual({ fileId: FILE, elementId: `file-${FILE}` });
  });

  it.each(['L', 'R'])('a line anchor (%s)', (letter) => {
    expect(parseHashTarget(`#f-${FILE}-${letter}12`)).toEqual({
      fileId: FILE,
      elementId: `f-${FILE}-${letter}12`,
    });
  });

  it('works without the leading #', () => {
    expect(parseHashTarget(`file-${FILE}`)?.fileId).toBe(FILE);
  });

  it.each([
    '',
    '#',
    '#files',
    '#file-',
    '#file-not-a-uuid',
    `#file-${FILE}x`,
    `#f-${FILE}-L0`,
    `#f-${FILE}-X1`,
    '#description',
    `#file-${FILE}#f-${FILE}-L1`,
  ])('ignores %j', (hash) => {
    expect(parseHashTarget(hash)).toBeNull();
  });
});
