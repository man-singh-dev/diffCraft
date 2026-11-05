import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { CommentBodySchema, CreateThreadRequestSchema, ReplyRequestSchema } from './comments.ts';
import { parsePatch } from './diff/parse-patch.ts';
import type { DiffHunk } from './diff/schemas.ts';
import {
  buildSuggestionPatch,
  commentSuggestion,
  countSuggestions,
  parseCommentBody,
} from './suggestions.ts';

describe('parseCommentBody', () => {
  it('returns one text part for a body without a suggestion', () => {
    expect(parseCommentBody('Looks good\nThanks')).toEqual([
      { type: 'text', text: 'Looks good\nThanks' },
    ]);
  });

  it('parses a body that is only a suggestion', () => {
    expect(parseCommentBody('```suggestion\nconst b = 2;\n```')).toEqual([
      { type: 'suggestion', lines: ['const b = 2;'] },
    ]);
  });

  it('keeps text before and after, without the blank lines around the block', () => {
    const body =
      'Use 2 here:\n\n```suggestion\nconst b = 2;\n  return b;\n```\n\nWhat do you think?';
    expect(parseCommentBody(body)).toEqual([
      { type: 'text', text: 'Use 2 here:' },
      { type: 'suggestion', lines: ['const b = 2;', '  return b;'] },
      { type: 'text', text: 'What do you think?' },
    ]);
  });

  it('allows trailing spaces on the fences, but nothing before them', () => {
    expect(parseCommentBody('```suggestion  \nx\n```   ')).toEqual([
      { type: 'suggestion', lines: ['x'] },
    ]);
    expect(parseCommentBody(' ```suggestion\nx\n```')).toEqual([
      { type: 'text', text: ' ```suggestion\nx\n```' },
    ]);
    expect(parseCommentBody('```suggestion js\nx\n```')).toEqual([
      { type: 'text', text: '```suggestion js\nx\n```' },
    ]);
  });

  it('an empty block suggests deleting the line', () => {
    expect(parseCommentBody('```suggestion\n```')).toEqual([{ type: 'suggestion', lines: [] }]);
  });

  it('keeps empty lines inside the block', () => {
    expect(parseCommentBody('```suggestion\na\n\nb\n```')).toEqual([
      { type: 'suggestion', lines: ['a', '', 'b'] },
    ]);
  });

  it('treats an unclosed fence as plain text', () => {
    const body = 'Try:\n```suggestion\nconst b = 2;';
    expect(parseCommentBody(body)).toEqual([{ type: 'text', text: body }]);
  });

  it('tolerates CRLF line endings', () => {
    expect(parseCommentBody('Before\r\n```suggestion\r\nconst b = 2;\r\n```\r\nAfter')).toEqual([
      { type: 'text', text: 'Before' },
      { type: 'suggestion', lines: ['const b = 2;'] },
      { type: 'text', text: 'After' },
    ]);
  });

  it('parses two blocks (which the body schema then rejects)', () => {
    const body = '```suggestion\na\n```\nor\n```suggestion\nb\n```';
    expect(parseCommentBody(body)).toEqual([
      { type: 'suggestion', lines: ['a'] },
      { type: 'text', text: 'or' },
      { type: 'suggestion', lines: ['b'] },
    ]);
    expect(countSuggestions(body)).toBe(2);
    expect(commentSuggestion(body)).toEqual(['a']);
  });

  it('stays fast on many unclosed fences', () => {
    const body = '```suggestion\n'.repeat(50_000);
    const started = performance.now();
    expect(parseCommentBody(body)).toHaveLength(1);
    expect(performance.now() - started).toBeLessThan(1_000);
  });
});

describe('CommentBodySchema and suggestions', () => {
  const two = '```suggestion\na\n```\n```suggestion\nb\n```';

  it('accepts one suggestion', () => {
    expect(CommentBodySchema.safeParse('Nit:\n```suggestion\na\n```').success).toBe(true);
  });

  it.each([
    ['CommentBodySchema', () => CommentBodySchema.safeParse(two)],
    ['create', () => CreateThreadRequestSchema.safeParse({ body: two })],
    ['reply / edit', () => ReplyRequestSchema.safeParse({ body: two })],
  ])('rejects two suggestions (%s)', (_name, parse) => {
    const result = parse();
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.message)).toEqual([
      'Only one suggestion per comment',
    ]);
  });

  it('does not count an unclosed second fence', () => {
    expect(CommentBodySchema.safeParse('```suggestion\na\n```\n```suggestion\nb').success).toBe(
      true,
    );
  });
});

const NEW_FILE = [
  "import x from 'x';",
  '',
  'const port = 8080;',
  "const host = 'localhost';",
  '',
  'function start() {',
  '  listen(port);',
  '}',
  '',
  '// nothing',
  'function stop() {',
  '  close(port);',
  '}',
  'export { start, stop };',
];

const APP_PATCH = `--- a/src/app.ts
+++ b/src/app.ts
@@ -1,6 +1,7 @@
 import x from 'x';

-const port = 3000;
+const port = 8080;
+const host = 'localhost';

 function start() {
   listen(port);
@@ -10,4 +11,4 @@ function start() {
 function stop() {
-  close();
+  close(port);
 }
 export { start, stop };
`;

const hunksOf = (patch: string): DiffHunk[] => parsePatch(patch).files[0]!.hunks;

interface FileText {
  lines: string[];
  finalNewline: boolean;
}

function applySuggestion(file: FileText, patch: string): FileText {
  const { files } = parsePatch(patch);
  expect(files).toHaveLength(1);
  expect(files[0]!.hunks).toHaveLength(1);
  const hunk = files[0]!.hunks[0]!;
  const removed = hunk.lines.filter((l) => l.type !== 'add');
  const kept = hunk.lines.filter((l) => l.type !== 'del');
  const from = hunk.oldStart - 1;
  expect(file.lines.slice(from, from + removed.length)).toEqual(removed.map((l) => l.content));

  const reachesEnd = from + removed.length === file.lines.length;
  const lines = [
    ...file.lines.slice(0, from),
    ...kept.map((l) => l.content),
    ...file.lines.slice(from + removed.length),
  ];
  const lastKept = kept.at(-1);
  const finalNewline = reachesEnd && lastKept ? !lastKept.noNewlineAtEnd : file.finalNewline;
  return { lines, finalNewline: lines.length > 0 && finalNewline };
}

const appFile: FileText = { lines: NEW_FILE, finalNewline: true };
const replaced = (at: number, deleteCount: number, ...items: string[]) => {
  const lines = [...NEW_FILE];
  lines.splice(at - 1, deleteCount, ...items);
  return lines;
};

describe('buildSuggestionPatch', () => {
  const build = (line: number, suggestedLines: string[], patch = APP_PATCH, path = 'src/app.ts') =>
    buildSuggestionPatch({ path, hunks: hunksOf(patch), line, suggestedLines });

  it('replaces a line in the middle of a hunk, with 3 lines of context on each side', () => {
    const patch = build(4, ["const host = '0.0.0.0';"]);
    expect(patch!.split('\n')).toEqual([
      '--- a/src/app.ts',
      '+++ b/src/app.ts',
      '@@ -1,7 +1,7 @@',
      " import x from 'x';",
      ' ',
      ' const port = 8080;',
      "-const host = 'localhost';",
      "+const host = '0.0.0.0';",
      ' ',
      ' function start() {',
      '   listen(port);',
      '',
    ]);
    expect(applySuggestion(appFile, patch!).lines).toEqual(
      replaced(4, 1, "const host = '0.0.0.0';"),
    );
  });

  it('takes context only from the same hunk: a line at the start of one', () => {
    const patch = build(11, ['function stop(code) {']);
    expect(patch).toContain('@@ -11,4 +11,4 @@\n-function stop() {\n+function stop(code) {\n');
    expect(applySuggestion(appFile, patch!).lines).toEqual(
      replaced(11, 1, 'function stop(code) {'),
    );
  });

  it('a line at the end of a hunk has context before it only', () => {
    const patch = build(7, ['  listen(port, host);']);
    expect(patch).toContain('@@ -4,4 +4,4 @@\n');
    expect(patch!.trimEnd().split('\n').at(-1)).toBe('+  listen(port, host);');
    expect(applySuggestion(appFile, patch!).lines).toEqual(replaced(7, 1, '  listen(port, host);'));
  });

  it('a line at the start of the file', () => {
    const patch = build(1, ["import y from 'y';"]);
    expect(patch).toContain('@@ -1,4 +1,4 @@\n');
    expect(applySuggestion(appFile, patch!).lines).toEqual(replaced(1, 1, "import y from 'y';"));
  });

  it('an empty suggestion deletes the line', () => {
    const patch = build(4, []);
    expect(patch).toContain(
      "@@ -1,7 +1,6 @@\n import x from 'x';\n \n const port = 8080;\n-const host",
    );
    expect(applySuggestion(appFile, patch!).lines).toEqual(replaced(4, 1));
  });

  it('replaces one line with several', () => {
    const patch = build(12, ['  close(port);', "  log('closed');"]);
    expect(patch).toContain('@@ -11,4 +11,5 @@\n');
    expect(applySuggestion(appFile, patch!).lines).toEqual(
      replaced(12, 1, '  close(port);', "  log('closed');"),
    );
  });

  it('a single-line hunk, replaced and deleted', () => {
    const single = '--- a/x.txt\n+++ b/x.txt\n@@ -5 +5 @@\n-a\n+b\n';
    const file: FileText = { lines: ['1', '2', '3', '4', 'b', '6'], finalNewline: true };

    const patch = build(5, ['c'], single, 'x.txt');
    expect(patch).toBe('--- a/x.txt\n+++ b/x.txt\n@@ -5,1 +5,1 @@\n-b\n+c\n');
    expect(applySuggestion(file, patch!).lines).toEqual(['1', '2', '3', '4', 'c', '6']);

    const deletion = build(5, [], single, 'x.txt');
    expect(deletion).toBe('--- a/x.txt\n+++ b/x.txt\n@@ -5,1 +4,0 @@\n-b\n');
    expect(applySuggestion(file, deletion!).lines).toEqual(['1', '2', '3', '4', '6']);
  });

  describe('a file without a final newline', () => {
    const readme = `--- a/README.md
+++ b/README.md
@@ -1,2 +1,2 @@
 # Title
-old end
\\ No newline at end of file
+new end
\\ No newline at end of file
`;
    const file: FileText = { lines: ['# Title', 'new end'], finalNewline: false };

    it('replacing the last line keeps it without a newline', () => {
      const patch = build(2, ['better end'], readme, 'README.md');
      expect(patch).toBe(`--- a/README.md
+++ b/README.md
@@ -1,2 +1,2 @@
 # Title
-new end
\\ No newline at end of file
+better end
\\ No newline at end of file
`);
      expect(applySuggestion(file, patch!)).toEqual({
        lines: ['# Title', 'better end'],
        finalNewline: false,
      });
    });

    it('the marker follows the last line when it is context', () => {
      const patch = build(1, ['# Better title'], readme, 'README.md');
      expect(patch).toBe(`--- a/README.md
+++ b/README.md
@@ -1,2 +1,2 @@
-# Title
+# Better title
 new end
\\ No newline at end of file
`);
      expect(applySuggestion(file, patch!)).toEqual({
        lines: ['# Better title', 'new end'],
        finalNewline: false,
      });
    });

    it('deleting the last line leaves the one before it, with its newline', () => {
      const patch = build(2, [], readme, 'README.md');
      expect(patch).toBe(`--- a/README.md
+++ b/README.md
@@ -1,2 +1,1 @@
 # Title
-new end
\\ No newline at end of file
`);
      expect(applySuggestion(file, patch!)).toEqual({ lines: ['# Title'], finalNewline: true });
    });

    it('a context line without a final newline after the change', () => {
      const ctx =
        '--- a/c.txt\n+++ b/c.txt\n@@ -1,2 +1,2 @@\n-a\n+b\n c\n\\ No newline at end of file\n';
      const patch = build(1, ['B'], ctx, 'c.txt');
      expect(patch).toBe(
        '--- a/c.txt\n+++ b/c.txt\n@@ -1,2 +1,2 @@\n-b\n+B\n c\n\\ No newline at end of file\n',
      );
      expect(applySuggestion({ lines: ['b', 'c'], finalNewline: false }, patch!)).toEqual({
        lines: ['B', 'c'],
        finalNewline: false,
      });
    });
  });

  it('returns null for a line that is not on the new side of the hunks', () => {
    expect(build(9, ['x'])).toBeNull();
    expect(build(99, ['x'])).toBeNull();
    const deleted = '--- a/gone.txt\n+++ /dev/null\n@@ -1,2 +0,0 @@\n-a\n-b\n';
    expect(build(1, ['x'], deleted, 'gone.txt')).toBeNull();
  });

  it('quotes a path that git would quote', () => {
    const patch = build(4, ['x'], APP_PATCH, 'src/say "hi".ts');
    expect(patch).toMatch(/^--- "a\/src\/say \\"hi\\".ts"\n\+\+\+ "b\/src\/say \\"hi\\".ts"\n/);
    expect(parsePatch(patch!).files[0]!.newPath).toBe('src/say "hi".ts');
  });
});

const hasGit = spawnSync('git', ['--version']).status === 0;

describe.skipIf(!hasGit)('buildSuggestionPatch with git apply', () => {
  const root = mkdtempSync(join(tmpdir(), 'diffcraft-suggestion-'));
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  const git = (cwd: string, ...args: string[]) =>
    spawnSync('git', ['-c', 'core.autocrlf=false', ...args], { cwd, encoding: 'utf8' });

  function write(path: string, text: string) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  }

  const cases = [
    {
      name: 'replace a line',
      path: 'src/app.ts',
      oldText: 'a\nb\nc\nd\ne\nf\ng\nh\n',
      newText: 'a\nb\nc\nD\ne\nf\ng\nh\n',
      line: 4,
      suggested: ['D2'],
      expected: 'a\nb\nc\nD2\ne\nf\ng\nh\n',
    },
    {
      name: 'delete a line',
      path: 'src/app.ts',
      oldText: 'a\nb\nc\n',
      newText: 'a\nB\nc\n',
      line: 2,
      suggested: [],
      expected: 'a\nc\n',
    },
    {
      name: 'several lines, in a path with a space',
      path: 'docs/read me.md',
      oldText: '# T\none\ntwo\n',
      newText: '# T\nONE\ntwo\n',
      line: 2,
      suggested: ['ONE', 'one and a half'],
      expected: '# T\nONE\none and a half\ntwo\n',
    },
    {
      name: 'the last line of a file without a final newline',
      path: 'end.txt',
      oldText: 'first\nlast',
      newText: 'first\nLAST',
      line: 2,
      suggested: ['very last'],
      expected: 'first\nvery last',
    },
    {
      name: 'a line before a last line without a final newline',
      path: 'end.txt',
      oldText: 'first\nlast',
      newText: 'FIRST\nlast',
      line: 1,
      suggested: ['First'],
      expected: 'First\nlast',
    },
  ];

  it.each(cases)('$name', ({ name, path, oldText, newText, line, suggested, expected }) => {
    const dir = join(root, name.replace(/\W+/g, '-'));
    write(join(dir, 'old', path), oldText);
    write(join(dir, 'new', path), newText);
    const diff = git(dir, 'diff', '--no-index', '--no-color', join('old', path), join('new', path));
    expect(diff.status).toBe(1);
    const hunks = hunksOf(diff.stdout);

    const patch = buildSuggestionPatch({ path, hunks, line, suggestedLines: suggested });
    expect(patch).not.toBeNull();
    const work = join(dir, 'work');
    write(join(work, path), newText);
    write(join(dir, 'suggestion.patch'), patch!);

    const check = git(work, 'apply', '--check', join(dir, 'suggestion.patch'));
    expect(check.stderr).toBe('');
    expect(check.status).toBe(0);
    expect(git(work, 'apply', join(dir, 'suggestion.patch')).status).toBe(0);
    expect(readFileSync(join(work, path), 'utf8')).toBe(expected);
  });
});

if (!hasGit) {
  describe('buildSuggestionPatch with git apply', () => {
    it.skip('skipped: git is not installed or not on PATH', () => {});
  });
}
