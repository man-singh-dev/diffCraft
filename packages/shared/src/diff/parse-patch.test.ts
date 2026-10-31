import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DiffParseError, parsePatch } from './parse-patch.js';
import { ParsedPatchSchema, type DiffLine } from './schemas.js';

const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/${name}.patch`, import.meta.url), 'utf8');

/** Parses a fixture and checks the result against the shared schema. */
function parseFixture(name: string) {
  const parsed = parsePatch(fixture(name));
  expect(ParsedPatchSchema.parse(parsed)).toEqual(parsed);
  return parsed;
}

const summary = (lines: DiffLine[]) =>
  lines.map((l) => [l.type, l.oldNumber, l.newNumber, l.content] as const);

function parseError(text: string, limits?: Parameters<typeof parsePatch>[1]): DiffParseError {
  try {
    parsePatch(text, limits);
  } catch (error) {
    if (error instanceof DiffParseError) return error;
    throw error;
  }
  throw new Error('expected a DiffParseError');
}

describe('parsePatch: fixtures', () => {
  it('modified file with two hunks: exact line numbers and counts', () => {
    const [file] = parseFixture('modified-two-hunks').files;

    expect(file).toMatchObject({
      oldPath: 'numbers.txt',
      newPath: 'numbers.txt',
      changeType: 'modified',
      isBinary: false,
      additions: 3,
      deletions: 2,
    });
    const [first, second] = file!.hunks;
    expect(first).toMatchObject({ oldStart: 1, oldLines: 6, newStart: 1, newLines: 6 });
    expect(first!.section).toBeNull();
    expect(summary(first!.lines)).toEqual([
      ['context', 1, 1, 'line 1'],
      ['context', 2, 2, 'line 2'],
      ['del', 3, null, 'line 3'],
      ['add', null, 3, 'line three'],
      ['context', 4, 4, 'line 4'],
      ['context', 5, 5, 'line 5'],
      ['context', 6, 6, 'line 6'],
    ]);
    expect(second).toMatchObject({
      header: '@@ -24,7 +24,8 @@ line 23',
      oldStart: 24,
      oldLines: 7,
      newStart: 24,
      newLines: 8,
      section: 'line 23',
    });
    expect(summary(second!.lines)).toEqual([
      ['context', 24, 24, 'line 24'],
      ['context', 25, 25, 'line 25'],
      ['context', 26, 26, 'line 26'],
      ['del', 27, null, 'line 27'],
      ['add', null, 27, 'line twenty-seven'],
      ['context', 28, 28, 'line 28'],
      ['add', null, 29, 'line 28.5'],
      ['context', 29, 30, 'line 29'],
      ['context', 30, 31, 'line 30'],
    ]);
  });

  it('added file', () => {
    const [file] = parseFixture('added').files;
    expect(file).toMatchObject({
      oldPath: null,
      newPath: 'greet.ts',
      changeType: 'added',
      additions: 2,
      deletions: 0,
    });
    expect(file!.hunks[0]).toMatchObject({ oldStart: 0, oldLines: 0, newStart: 1, newLines: 2 });
    expect(summary(file!.hunks[0]!.lines)).toEqual([
      ['add', null, 1, 'export const greet = (name: string) =>'],
      ['add', null, 2, '  `Hello, ${name}!`;'],
    ]);
  });

  it('deleted file', () => {
    const [file] = parseFixture('deleted').files;
    expect(file).toMatchObject({
      oldPath: 'greet.ts',
      newPath: null,
      changeType: 'deleted',
      additions: 0,
      deletions: 2,
    });
    expect(file!.hunks[0]!.lines.map((l) => [l.oldNumber, l.newNumber])).toEqual([
      [1, null],
      [2, null],
    ]);
  });

  it('rename with changes', () => {
    const [file] = parseFixture('rename-with-changes').files;
    expect(file).toMatchObject({
      oldPath: 'old-name.txt',
      newPath: 'new-name.txt',
      changeType: 'renamed',
      additions: 1,
      deletions: 1,
    });
    expect(file!.hunks).toHaveLength(1);
  });

  it('pure rename with no hunks', () => {
    expect(parseFixture('pure-rename').files).toEqual([
      {
        oldPath: 'new-name.txt',
        newPath: 'src-name.txt',
        changeType: 'renamed',
        isBinary: false,
        additions: 0,
        deletions: 0,
        hunks: [],
      },
    ]);
  });

  it('binary file', () => {
    expect(parseFixture('binary').files).toEqual([
      {
        oldPath: 'logo.png',
        newPath: 'logo.png',
        changeType: 'modified',
        isBinary: true,
        additions: 0,
        deletions: 0,
        hunks: [],
      },
    ]);
  });

  it('mode-only change', () => {
    const [file] = parseFixture('mode-only').files;
    expect(file).toMatchObject({ oldPath: 'run.sh', newPath: 'run.sh', changeType: 'modified' });
    expect(file!.hunks).toEqual([]);
  });

  it('no newline at end of file on both sides', () => {
    const lines = parseFixture('no-newline').files[0]!.hunks[0]!.lines;
    expect(lines.map((l) => [l.type, l.content, l.noNewlineAtEnd])).toEqual([
      ['context', 'first', false],
      ['del', 'last', true],
      ['add', 'final', true],
    ]);
  });

  it('CRLF line endings parse like LF ones', () => {
    const crlf = fixture('crlf');
    expect(crlf).toContain('\r\n');
    expect(parsePatch(crlf)).toEqual(parseFixture('no-newline'));
  });

  it('omitted hunk counts mean 1', () => {
    const hunk = parseFixture('omitted-counts').files[0]!.hunks[0]!;
    expect(hunk).toMatchObject({ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1 });
    expect(summary(hunk.lines)).toEqual([
      ['del', 1, null, 'v1'],
      ['add', null, 1, 'v2'],
    ]);
  });

  it('treats "--- x" and "+++ y" inside a hunk as content', () => {
    const [loop, query] = parseFixture('dash-plus-content').files;

    expect(loop!.newPath).toBe('loop.c');
    expect(summary(loop!.hunks[0]!.lines)).toEqual([
      ['context', 1, 1, 'int i = 0;'],
      ['del', 2, null, 'i++;'],
      ['add', null, 2, '++i;'],
      ['add', null, 3, '++counter;'],
    ]);
    expect(query!.newPath).toBe('query.sql');
    expect(summary(query!.hunks[0]!.lines)).toEqual([
      ['context', 1, 1, 'SELECT 1;'],
      ['del', 2, null, '-- old comment'],
      ['context', 3, 2, 'SELECT 2;'],
    ]);
  });

  it('quoted path with spaces and escaped UTF-8', () => {
    const [file] = parseFixture('quoted-path').files;
    expect(file).toMatchObject({
      oldPath: 'café menu.txt',
      newPath: 'café menu.txt',
      changeType: 'modified',
      additions: 1,
    });
  });

  it('plain diff -u output with timestamps', () => {
    const [file] = parseFixture('plain-diff-u').files;
    expect(file).toMatchObject({
      oldPath: 'old/config.ini',
      newPath: 'new/config.ini',
      changeType: 'modified',
      additions: 2,
      deletions: 1,
    });
    expect(summary(file!.hunks[0]!.lines)).toEqual([
      ['context', 1, 1, 'alpha'],
      ['del', 2, null, 'beta'],
      ['add', null, 2, 'BETA'],
      ['context', 3, 3, 'gamma'],
      ['add', null, 4, 'delta'],
    ]);
  });

  it('multiple files', () => {
    const files = parseFixture('multiple-files').files;
    expect(
      files.map((f) => [f.oldPath, f.newPath, f.changeType, f.additions, f.deletions]),
    ).toEqual([
      ['a.txt', 'a.txt', 'modified', 1, 1],
      ['b.txt', null, 'deleted', 0, 1],
      [null, 'c.txt', 'added', 1, 0],
    ]);
  });
});

describe('parsePatch: other input', () => {
  it('skips a format-patch email header, diffstat and signature', () => {
    const text = [
      'From 1234 Mon Sep 17 00:00:00 2001',
      'Subject: [PATCH] Bump version',
      '',
      '---',
      ' version.txt | 2 +-',
      '',
      fixture('omitted-counts').trimEnd(),
      '-- ',
      '2.47.0',
      '',
    ].join('\n');
    expect(parsePatch(text).files).toHaveLength(1);
  });

  it('splits an unquoted git header with spaces when there are no ---/+++ lines', () => {
    const text =
      'diff --git a/my dir/run me.sh b/my dir/run me.sh\nold mode 100644\nnew mode 100755\n';
    expect(parsePatch(text).files[0]).toMatchObject({
      oldPath: 'my dir/run me.sh',
      newPath: 'my dir/run me.sh',
    });
  });

  it('accepts an empty line as context whose trailing space was stripped', () => {
    const text = '--- a/x\n+++ b/x\n@@ -1,3 +1,3 @@\n a\n\n-b\n+B\n';
    expect(summary(parsePatch(text).files[0]!.hunks[0]!.lines)).toEqual([
      ['context', 1, 1, 'a'],
      ['context', 2, 2, ''],
      ['del', 3, null, 'b'],
      ['add', null, 3, 'B'],
    ]);
  });
});

describe('parsePatch: errors', () => {
  it.each(['', '   \n\n'])('rejects empty input %j', (text) => {
    expect(parseError(text)).toMatchObject({ code: 'empty_patch', line: null });
  });

  it('rejects text with no file changes', () => {
    expect(parseError('hello\nthis is not a diff\n')).toMatchObject({
      code: 'not_a_patch',
      line: null,
    });
  });

  it('rejects a malformed hunk header', () => {
    const text = '--- a/x\n+++ b/x\n@@ -1,x +1 @@\n-a\n';
    expect(parseError(text)).toMatchObject({ code: 'malformed_hunk', line: 3 });
  });

  it('rejects a hunk with fewer lines than its header says', () => {
    const text = '--- a/x\n+++ b/x\n@@ -1,3 +1,3 @@\n a\n-b\n+B\n';
    expect(parseError(text)).toMatchObject({ code: 'count_mismatch', line: 3 });
  });

  it('rejects a hunk with more lines than its header says', () => {
    const text = '--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+A\n+extra\n';
    expect(parseError(text)).toMatchObject({ code: 'count_mismatch', line: 6 });
  });

  it('rejects a line whose kind the counts no longer allow', () => {
    const text = '--- a/x\n+++ b/x\n@@ -1,2 +1 @@\n-a\n+A\n+B\n';
    expect(parseError(text)).toMatchObject({ code: 'count_mismatch', line: 6 });
  });

  it('rejects "---" without "+++" in a git header', () => {
    const text = 'diff --git a/x b/x\n--- a/x\n@@ -1 +1 @@\n';
    expect(parseError(text)).toMatchObject({ code: 'malformed_header', line: 3 });
  });

  it('checks the size limit in UTF-8 bytes', () => {
    const patch = fixture('modified-two-hunks');
    expect(parseError(patch, { maxBytes: patch.length - 1 })).toMatchObject({
      code: 'too_large',
      line: null,
    });
    expect(() => parsePatch('--- a/é\n+++ b/é\n@@ -1 +1 @@\n-é\n+e\n', { maxBytes: 36 })).toThrow(
      DiffParseError,
    );
    expect(() =>
      parsePatch('--- a/é\n+++ b/é\n@@ -1 +1 @@\n-é\n+e\n', { maxBytes: 37 }),
    ).not.toThrow();
  });

  it('rejects more files than the limit at the first extra file', () => {
    expect(parseError(fixture('multiple-files'), { maxFiles: 2 })).toMatchObject({
      code: 'too_many_files',
      line: 15,
    });
  });

  it('rejects more diff lines than the limit', () => {
    expect(parseError(fixture('modified-two-hunks'), { maxLines: 10 })).toMatchObject({
      code: 'too_many_lines',
      line: 17,
    });
  });

  it('rejects a line longer than the limit', () => {
    const text = `--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+${'x'.repeat(100)}\n`;
    expect(parseError(text, { maxLineLength: 100 })).toMatchObject({
      code: 'line_too_long',
      line: 5,
    });
  });

  it('uses the default limits', () => {
    expect(parseError('x'.repeat(1024 * 1024 + 1)).code).toBe('too_large');
    expect(parseError(`${'x'.repeat(5_001)}\n`).code).toBe('line_too_long');
  });
});
