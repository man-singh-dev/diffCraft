import 'server-only';

import type { ColorToken, DiffHunk, DiffLine } from '@diffcraft/shared';
import { createHighlighterCore, type HighlighterCore, type LanguageInput } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';

/** Above this many diff lines in a file, the file is not highlighted. */
export const HIGHLIGHT_MAX_FILE_LINES = 5_000;
/** Lines longer than this are shown plain (the rest of the file is still highlighted). */
export const HIGHLIGHT_MAX_LINE_CHARS = 1_000;

export const HIGHLIGHT_THEME = 'github-dark';

// The allow-list: only these grammars can ever be loaded. Static import() paths let the
// bundler and file tracing see every file that may be needed.
const LANGUAGE_LOADERS = {
  c: () => import('shiki/langs/c.mjs'),
  cpp: () => import('shiki/langs/cpp.mjs'),
  csharp: () => import('shiki/langs/csharp.mjs'),
  css: () => import('shiki/langs/css.mjs'),
  docker: () => import('shiki/langs/docker.mjs'),
  go: () => import('shiki/langs/go.mjs'),
  graphql: () => import('shiki/langs/graphql.mjs'),
  html: () => import('shiki/langs/html.mjs'),
  java: () => import('shiki/langs/java.mjs'),
  javascript: () => import('shiki/langs/javascript.mjs'),
  json: () => import('shiki/langs/json.mjs'),
  jsx: () => import('shiki/langs/jsx.mjs'),
  kotlin: () => import('shiki/langs/kotlin.mjs'),
  markdown: () => import('shiki/langs/markdown.mjs'),
  php: () => import('shiki/langs/php.mjs'),
  python: () => import('shiki/langs/python.mjs'),
  ruby: () => import('shiki/langs/ruby.mjs'),
  rust: () => import('shiki/langs/rust.mjs'),
  scss: () => import('shiki/langs/scss.mjs'),
  shellscript: () => import('shiki/langs/shellscript.mjs'),
  sql: () => import('shiki/langs/sql.mjs'),
  svelte: () => import('shiki/langs/svelte.mjs'),
  swift: () => import('shiki/langs/swift.mjs'),
  toml: () => import('shiki/langs/toml.mjs'),
  tsx: () => import('shiki/langs/tsx.mjs'),
  typescript: () => import('shiki/langs/typescript.mjs'),
  vue: () => import('shiki/langs/vue.mjs'),
  xml: () => import('shiki/langs/xml.mjs'),
  yaml: () => import('shiki/langs/yaml.mjs'),
} satisfies Record<string, () => LanguageInput>;

export type HighlightLanguage = keyof typeof LANGUAGE_LOADERS;
export const HIGHLIGHT_LANGUAGES = Object.keys(LANGUAGE_LOADERS) as HighlightLanguage[];

const LANGUAGE_BY_EXTENSION: Record<string, HighlightLanguage> = {
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  tsx: 'tsx',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'jsx',
  json: 'json',
  md: 'markdown',
  markdown: 'markdown',
  css: 'css',
  scss: 'scss',
  html: 'html',
  htm: 'html',
  vue: 'vue',
  svelte: 'svelte',
  py: 'python',
  go: 'go',
  rs: 'rust',
  java: 'java',
  kt: 'kotlin',
  kts: 'kotlin',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  cxx: 'cpp',
  hpp: 'cpp',
  hh: 'cpp',
  cs: 'csharp',
  php: 'php',
  rb: 'ruby',
  swift: 'swift',
  sql: 'sql',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'toml',
  sh: 'shellscript',
  bash: 'shellscript',
  zsh: 'shellscript',
  dockerfile: 'docker',
  xml: 'xml',
  svg: 'xml',
  graphql: 'graphql',
  gql: 'graphql',
};

/** The Shiki language for a file path, or null if it isn't on the allow-list. */
export function languageForPath(path: string): HighlightLanguage | null {
  const name = (path.split('/').at(-1) ?? '').toLowerCase();
  if (name === 'dockerfile' || name.startsWith('dockerfile.')) return 'docker';
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return null; // no extension, or a dotfile such as ".env"
  return LANGUAGE_BY_EXTENSION[name.slice(dot + 1)] ?? null;
}

let highlighterPromise: Promise<HighlighterCore> | null = null;
const languagePromises = new Map<HighlightLanguage, Promise<void>>();

function getHighlighter(): Promise<HighlighterCore> {
  // The JavaScript engine avoids loading Oniguruma's WASM, so local and Vercel behave the same.
  highlighterPromise ??= createHighlighterCore({
    themes: [import('shiki/themes/github-dark.mjs')],
    langs: [],
    engine: createJavaScriptRegexEngine(),
  }).catch((error: unknown) => {
    highlighterPromise = null; // let the next request try again
    throw error;
  });
  return highlighterPromise;
}

async function loadLanguage(highlighter: HighlighterCore, language: HighlightLanguage) {
  let promise = languagePromises.get(language);
  if (!promise) {
    promise = highlighter.loadLanguage(LANGUAGE_LOADERS[language]()).catch((error: unknown) => {
      languagePromises.delete(language);
      throw error;
    });
    languagePromises.set(language, promise);
  }
  await promise;
}

/** Syntax tokens of a hunk's lines, by line number on each side. */
export interface HunkTokens {
  old: Map<number, ColorToken[]>;
  new: Map<number, ColorToken[]>;
}

const plainTokens = (content: string): ColorToken[] =>
  content === '' ? [] : [{ text: content, color: null }];

const oldSide = (hunk: DiffHunk) => hunk.lines.filter((l) => l.type !== 'add');
const newSide = (hunk: DiffHunk) => hunk.lines.filter((l) => l.type !== 'del');

function plainSide(lines: DiffLine[], number: (line: DiffLine) => number | null) {
  const map = new Map<number, ColorToken[]>();
  for (const line of lines) {
    const n = number(line);
    if (n !== null) map.set(n, plainTokens(line.content));
  }
  return map;
}

function plainHunks(hunks: DiffHunk[]): HunkTokens[] {
  return hunks.map((hunk) => ({
    old: plainSide(oldSide(hunk), (l) => l.oldNumber),
    new: plainSide(newSide(hunk), (l) => l.newNumber),
  }));
}

function highlightSide(
  highlighter: HighlighterCore,
  language: HighlightLanguage,
  lines: DiffLine[],
  number: (line: DiffLine) => number | null,
): Map<number, ColorToken[]> {
  const tooLong = (line: DiffLine) => line.content.length > HIGHLIGHT_MAX_LINE_CHARS;
  // A too-long line becomes an empty line, so the following lines keep their positions.
  const code = lines.map((l) => (tooLong(l) ? '' : l.content)).join('\n');
  const tokenLines = highlighter.codeToTokensBase(code, { lang: language, theme: HIGHLIGHT_THEME });

  const map = new Map<number, ColorToken[]>();
  lines.forEach((line, i) => {
    const n = number(line);
    if (n === null) return;
    const tokens = (tokenLines[i] ?? [])
      .filter((t) => t.content !== '')
      .map((t): ColorToken => ({ text: t.content, color: t.color ?? null }));
    const matches = tokens.map((t) => t.text).join('') === line.content;
    map.set(n, !tooLong(line) && matches ? tokens : plainTokens(line.content));
  });
  return map;
}

/**
 * Syntax tokens for every line of a file's hunks. Each hunk's old text (context + deleted lines)
 * and new text (context + added lines) are highlighted as two separate code blocks, so multi-line
 * constructs are read as they are on that side. Context lines are looked up on the new side.
 * Falls back to plain tokens (color null) when highlighting is off or fails.
 */
export async function highlightHunks(path: string, hunks: DiffHunk[]): Promise<HunkTokens[]> {
  const language = languageForPath(path);
  const totalLines = hunks.reduce((sum, h) => sum + h.lines.length, 0);
  if (language === null || totalLines === 0 || totalLines > HIGHLIGHT_MAX_FILE_LINES) {
    return plainHunks(hunks);
  }

  try {
    const highlighter = await getHighlighter();
    await loadLanguage(highlighter, language);
    return hunks.map((hunk) => ({
      old: highlightSide(highlighter, language, oldSide(hunk), (l) => l.oldNumber),
      new: highlightSide(highlighter, language, newSide(hunk), (l) => l.newNumber),
    }));
  } catch (error) {
    console.error(`[highlight] failed for ${path} (${language}); showing it plain`, error);
    return plainHunks(hunks);
  }
}

/** The tokens of the line with this number on one side, or plain tokens if there are none. */
export function lineTokens(
  tokens: HunkTokens | undefined,
  side: 'old' | 'new',
  number: number | null,
  content: string,
): ColorToken[] {
  const found = number === null ? undefined : tokens?.[side].get(number);
  return found ?? plainTokens(content);
}
