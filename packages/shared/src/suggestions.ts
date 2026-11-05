import type { DiffHunk } from './diff/schemas.ts';

export type CommentBodyPart =
  { type: 'text'; text: string } | { type: 'suggestion'; lines: string[] };

const OPEN_FENCE = '```suggestion';
const CLOSE_FENCE = '```';
const NO_NEWLINE = '\\ No newline at end of file';
const CONTEXT_LINES = 3;

export function parseCommentBody(body: string): CommentBodyPart[] {
  const lines = body.split('\n').map((line) => (line.endsWith('\r') ? line.slice(0, -1) : line));

  // Precomputed so an unclosed fence costs no rescans: linear time on any input.
  const nextClose = new Array<number>(lines.length + 1).fill(-1);
  for (let i = lines.length - 1; i >= 0; i--) {
    nextClose[i] = lines[i]!.trimEnd() === CLOSE_FENCE ? i : nextClose[i + 1]!;
  }

  const parts: CommentBodyPart[] = [];
  let text: string[] = [];
  const flushText = () => {
    let start = 0;
    let end = text.length;
    while (start < end && text[start]!.trim() === '') start++;
    while (end > start && text[end - 1]!.trim() === '') end--;
    if (start < end) parts.push({ type: 'text', text: text.slice(start, end).join('\n') });
    text = [];
  };

  let i = 0;
  while (i < lines.length) {
    const close = nextClose[i + 1]!;
    if (lines[i]!.trimEnd() === OPEN_FENCE && close !== -1) {
      flushText();
      parts.push({ type: 'suggestion', lines: lines.slice(i + 1, close) });
      i = close + 1;
    } else {
      text.push(lines[i]!);
      i++;
    }
  }
  flushText();
  return parts;
}

export function commentSuggestion(body: string): string[] | null {
  for (const part of parseCommentBody(body)) if (part.type === 'suggestion') return part.lines;
  return null;
}

export const countSuggestions = (body: string): number =>
  parseCommentBody(body).filter((part) => part.type === 'suggestion').length;

export interface SuggestionPatchInput {
  path: string;
  hunks: DiffHunk[];
  line: number;
  suggestedLines: string[];
}

interface NewSideLine {
  number: number;
  content: string;
  noNewlineAtEnd: boolean;
}

export function buildSuggestionPatch({
  path,
  hunks,
  line,
  suggestedLines,
}: SuggestionPatchInput): string | null {
  for (const hunk of hunks) {
    const newSide: NewSideLine[] = [];
    for (const diffLine of hunk.lines) {
      if (diffLine.type === 'del' || diffLine.newNumber === null) continue;
      const { content, noNewlineAtEnd } = diffLine;
      newSide.push({ number: diffLine.newNumber, content, noNewlineAtEnd });
    }
    const at = newSide.findIndex((l) => l.number === line);
    if (at === -1) continue;

    let first = at;
    while (
      first > 0 &&
      at - first < CONTEXT_LINES &&
      newSide[first - 1]!.number === newSide[first]!.number - 1
    ) {
      first--;
    }
    let last = at;
    while (
      last < newSide.length - 1 &&
      last - at < CONTEXT_LINES &&
      newSide[last + 1]!.number === newSide[last]!.number + 1
    ) {
      last++;
    }

    const target = newSide[at]!;
    const before = newSide.slice(first, at);
    const after = newSide.slice(at + 1, last + 1);
    const start = newSide[first]!.number;
    const oldCount = before.length + 1 + after.length;
    const newCount = before.length + suggestedLines.length + after.length;
    // With a count of 0, the start is the line before the (now empty) range.
    const newStart = newCount === 0 ? start - 1 : start;

    const name = quotePath(path);
    const out = [
      `--- ${name('a/')}`,
      `+++ ${name('b/')}`,
      `@@ -${start},${oldCount} +${newStart},${newCount} @@`,
    ];
    for (const l of before) out.push(` ${l.content}`);
    out.push(`-${target.content}`);
    if (target.noNewlineAtEnd) out.push(NO_NEWLINE);
    suggestedLines.forEach((suggested, index) => {
      out.push(`+${suggested}`);
      // The replacement keeps the file's missing final newline.
      if (target.noNewlineAtEnd && index === suggestedLines.length - 1) out.push(NO_NEWLINE);
    });
    for (const l of after) {
      out.push(` ${l.content}`);
      if (l.noNewlineAtEnd) out.push(NO_NEWLINE);
    }
    return `${out.join('\n')}\n`;
  }
  return null;
}

// Git's C-style quoting; a raw tab would end the name, as GNU diff puts a timestamp after one.
function quotePath(path: string): (prefix: string) => string {
  let escaped = '';
  for (const char of path) {
    const code = char.charCodeAt(0);
    if (char === '"' || char === '\\') escaped += `\\${char}`;
    else if (char === '\t') escaped += '\\t';
    else if (char === '\n') escaped += '\\n';
    else if (code < 0x20 || code === 0x7f) escaped += `\\${code.toString(8).padStart(3, '0')}`;
    else escaped += char;
  }
  if (escaped === path) return (prefix) => `${prefix}${path}`;
  return (prefix) => `"${prefix}${escaped}"`;
}
