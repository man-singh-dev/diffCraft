import { parsePatch, type ColorToken, type DiffHunk } from '@diffcraft/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';

// server-only throws outside a React Server Components build.
vi.mock('server-only', () => ({}));

const {
  HIGHLIGHT_LANGUAGES,
  HIGHLIGHT_MAX_FILE_LINES,
  HIGHLIGHT_MAX_LINE_CHARS,
  highlightHunks,
  languageForPath,
  lineTokens,
} = await import('./highlight.server.js');

function hunksOf(header: string, lines: string[]): DiffHunk[] {
  return parsePatch(['--- a/f', '+++ b/f', header, ...lines, ''].join('\n')).files[0]!.hunks;
}

const join = (tokens: ColorToken[]) => tokens.map((t) => t.text).join('');
const colors = (tokens: ColorToken[]) => new Set(tokens.map((t) => t.color));

function expectAllLinesCovered(
  hunks: DiffHunk[],
  tokens: Awaited<ReturnType<typeof highlightHunks>>,
) {
  expect(tokens).toHaveLength(hunks.length);
  hunks.forEach((hunk, i) => {
    for (const line of hunk.lines) {
      if (line.type !== 'add')
        expect(join(tokens[i]!.old.get(line.oldNumber!)!)).toBe(line.content);
      if (line.type !== 'del')
        expect(join(tokens[i]!.new.get(line.newNumber!)!)).toBe(line.content);
    }
  });
}

const allPlain = (tokens: Awaited<ReturnType<typeof highlightHunks>>) =>
  tokens.every((h) => [...h.old.values(), ...h.new.values()].flat().every((t) => t.color === null));

afterEach(() => {
  vi.restoreAllMocks();
});

describe('languageForPath', () => {
  it.each([
    ['src/index.ts', 'typescript'],
    ['a/b/Component.TSX', 'tsx'],
    ['vite.config.mts', 'typescript'],
    ['eslint.config.mjs', 'javascript'],
    ['legacy.cjs', 'javascript'],
    ['App.jsx', 'jsx'],
    ['package.json', 'json'],
    ['README.md', 'markdown'],
    ['styles/app.scss', 'scss'],
    ['index.html', 'html'],
    ['App.vue', 'vue'],
    ['Page.svelte', 'svelte'],
    ['main.py', 'python'],
    ['main.go', 'go'],
    ['lib.rs', 'rust'],
    ['Main.java', 'java'],
    ['build.gradle.kts', 'kotlin'],
    ['util.h', 'c'],
    ['util.hpp', 'cpp'],
    ['Program.cs', 'csharp'],
    ['index.php', 'php'],
    ['Rakefile.rb', 'ruby'],
    ['App.swift', 'swift'],
    ['schema.sql', 'sql'],
    ['ci.yml', 'yaml'],
    ['ci.yaml', 'yaml'],
    ['Cargo.toml', 'toml'],
    ['deploy.sh', 'shellscript'],
    ['run.bash', 'shellscript'],
    ['Dockerfile', 'docker'],
    ['infra/dockerfile', 'docker'],
    ['Dockerfile.dev', 'docker'],
    ['web.dockerfile', 'docker'],
    ['pom.xml', 'xml'],
    ['schema.graphql', 'graphql'],
  ])('%s → %s', (path, language) => {
    expect(languageForPath(path)).toBe(language);
  });

  it.each([
    'notes.txt',
    'Makefile',
    '.env',
    'src/.gitignore',
    'archive.tar.gz',
    'noext',
    'dir.ts/file',
    '',
  ])('%j → null', (path) => {
    expect(languageForPath(path)).toBeNull();
  });
});

describe('highlightHunks', () => {
  it('colors keywords and maps old and new lines to their numbers', async () => {
    const hunks = hunksOf('@@ -10,3 +10,3 @@', [
      ' export function total(items: number[]) {',
      '-  return items.length;',
      '+  const sum = items.reduce((a, b) => a + b, 0);',
      ' }',
    ]);
    const [tokens] = await highlightHunks('src/total.ts', hunks);
    expectAllLinesCovered(hunks, [tokens!]);

    expect([...tokens!.old.keys()]).toEqual([10, 11, 12]);
    expect([...tokens!.new.keys()]).toEqual([10, 11, 12]);
    expect(join(tokens!.old.get(11)!)).toBe('  return items.length;');
    expect(join(tokens!.new.get(11)!)).toBe('  const sum = items.reduce((a, b) => a + b, 0);');

    const color = (side: 'old' | 'new', n: number, text: string) =>
      tokens![side].get(n)!.find((t) => t.text === text)?.color;
    expect(color('new', 10, 'export')).toMatch(/^#[0-9a-f]{6}$/i);
    expect(color('old', 11, 'return')).toMatch(/^#[0-9a-f]{6}$/i);
    expect(color('new', 11, 'const')).toBe(color('old', 11, 'return'));
    expect(color('new', 11, 'sum')).not.toBe(color('new', 11, 'const'));
  });

  it('a block comment spanning context and added lines is a comment on every line', async () => {
    const hunks = hunksOf('@@ -1,2 +1,4 @@', [
      ' /**',
      '+ * Adds two numbers.',
      '+ */',
      ' const x = 1;',
    ]);
    const [tokens] = await highlightHunks('math.ts', hunks);
    expectAllLinesCovered(hunks, [tokens!]);

    const commentColor = tokens!.new.get(1)![0]!.color;
    expect(commentColor).not.toBeNull();
    for (const n of [1, 2, 3]) expect(colors(tokens!.new.get(n)!)).toEqual(new Set([commentColor]));
    expect(tokens!.new.get(4)!.find((t) => t.text === 'const')!.color).not.toBe(commentColor);
    // The old side never had the closing "*/", so it is highlighted as its own block.
    expect(colors(tokens!.old.get(2)!)).toEqual(new Set([commentColor]));
  });

  it('unknown extension: plain tokens', async () => {
    const hunks = hunksOf('@@ -1 +1 @@', ['-const a = 1;', '+const a = 2;']);
    const tokens = await highlightHunks('notes.txt', hunks);
    expectAllLinesCovered(hunks, tokens);
    expect(allPlain(tokens)).toBe(true);
    expect(tokens[0]!.new.get(1)).toEqual([{ text: 'const a = 2;', color: null }]);
  });

  it('more diff lines than the file limit: plain tokens', async () => {
    const count = HIGHLIGHT_MAX_FILE_LINES + 1;
    const hunks = hunksOf(
      `@@ -0,0 +1,${count} @@`,
      Array.from({ length: count }, (_, i) => `+const v${i} = ${i};`),
    );
    const tokens = await highlightHunks('big.ts', hunks);
    expect(allPlain(tokens)).toBe(true);
    expect(tokens[0]!.new.size).toBe(count);
  });

  it('a line over the length limit is plain; the others are still highlighted', async () => {
    const long = `const s = "${'x'.repeat(HIGHLIGHT_MAX_LINE_CHARS)}";`;
    const hunks = hunksOf('@@ -0,0 +1,3 @@', ['+const a = 1;', `+${long}`, '+const b = 2;']);
    const [tokens] = await highlightHunks('long.ts', hunks);
    expectAllLinesCovered(hunks, [tokens!]);
    expect(tokens!.new.get(2)).toEqual([{ text: long, color: null }]);
    expect(colors(tokens!.new.get(1)!).has(null)).toBe(false);
    expect(colors(tokens!.new.get(3)!).has(null)).toBe(false);
  });

  it('an empty line has no tokens', async () => {
    const hunks = hunksOf('@@ -0,0 +1,3 @@', ['+const a = 1;', '+', '+const b = 2;']);
    const [tokens] = await highlightHunks('empty.ts', hunks);
    expect(tokens!.new.get(2)).toEqual([]);
  });

  it('no hunks: no tokens', async () => {
    expect(await highlightHunks('logo.ts', [])).toEqual([]);
  });

  it('every allow-listed language loads and highlights with the JavaScript engine', async () => {
    const error = vi.spyOn(console, 'error');
    const paths = HIGHLIGHT_LANGUAGES.map((language) => {
      const path = [
        'src/a.ts',
        'App.tsx',
        'a.js',
        'a.jsx',
        'a.json',
        'a.md',
        'a.css',
        'a.scss',
        'a.html',
        'a.vue',
        'a.svelte',
        'a.py',
        'a.go',
        'a.rs',
        'A.java',
        'a.kt',
        'a.c',
        'a.cpp',
        'a.cs',
        'a.php',
        'a.rb',
        'a.swift',
        'a.sql',
        'a.yml',
        'a.toml',
        'a.sh',
        'Dockerfile',
        'a.xml',
        'a.graphql',
      ].find((p) => languageForPath(p) === language);
      expect(path, language).toBeDefined();
      return path!;
    });
    const hunks = hunksOf('@@ -0,0 +1,1 @@', ['+name = "value" # 1']);
    for (const path of paths) expectAllLinesCovered(hunks, await highlightHunks(path, hunks));
    expect(error).not.toHaveBeenCalled();
  });
});

describe('lineTokens', () => {
  it('falls back to plain tokens when a line is missing', () => {
    expect(lineTokens(undefined, 'new', 3, 'x')).toEqual([{ text: 'x', color: null }]);
    expect(lineTokens({ old: new Map(), new: new Map() }, 'old', null, '')).toEqual([]);
  });
});
