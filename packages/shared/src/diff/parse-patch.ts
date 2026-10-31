import type { DiffFile, DiffHunk, DiffLine, ParsedPatch } from './schemas.ts';

export interface DiffLimits {
  /** UTF-8 bytes in the whole patch. */
  maxBytes: number;
  maxFiles: number;
  /** Context, added and removed lines across all hunks. */
  maxLines: number;
  /** Characters in any one line of the patch. */
  maxLineLength: number;
}

export const DEFAULT_DIFF_LIMITS: Readonly<DiffLimits> = {
  maxBytes: 1024 * 1024,
  maxFiles: 300,
  maxLines: 20_000,
  maxLineLength: 5_000,
};

export type DiffParseErrorCode =
  | 'empty_patch'
  | 'too_large'
  | 'too_many_files'
  | 'too_many_lines'
  | 'line_too_long'
  | 'not_a_patch'
  | 'malformed_header'
  | 'malformed_hunk'
  | 'count_mismatch';

const MESSAGES: Record<DiffParseErrorCode, string> = {
  empty_patch: 'The patch is empty.',
  too_large: 'The patch is too large.',
  too_many_files: 'The patch changes too many files.',
  too_many_lines: 'The patch has too many lines.',
  line_too_long: 'A line in the patch is too long.',
  not_a_patch: 'No file changes were found. Is this a unified diff?',
  malformed_header: 'A file header is malformed.',
  malformed_hunk: 'A hunk is malformed.',
  count_mismatch: "A hunk's lines don't match the counts in its @@ header.",
};

export class DiffParseError extends Error {
  readonly code: DiffParseErrorCode;
  /** 1-based line in the patch, or null when the input as a whole is rejected. */
  readonly line: number | null;

  constructor(code: DiffParseErrorCode, line: number | null) {
    super(line === null ? MESSAGES[code] : `${MESSAGES[code]} (line ${line})`);
    this.name = 'DiffParseError';
    this.code = code;
    this.line = line;
  }
}

/**
 * Parses a unified diff: git output (`git diff`, `git format-patch`) or plain `diff -u`.
 * Throws a DiffParseError for input it can't trust. Content is only ever treated as text.
 */
export function parsePatch(text: string, limits: Partial<DiffLimits> = {}): ParsedPatch {
  const max: DiffLimits = { ...DEFAULT_DIFF_LIMITS, ...limits };
  // The cheap length check first: UTF-8 is never shorter than UTF-16.
  if (text.length > max.maxBytes || utf8Length(text) > max.maxBytes) {
    throw new DiffParseError('too_large', null);
  }
  if (text.trim() === '') throw new DiffParseError('empty_patch', null);

  const lines = splitLines(text);
  lines.forEach((line, index) => {
    if (line.length > max.maxLineLength) throw new DiffParseError('line_too_long', index + 1);
  });

  const files = new PatchParser(lines, max).parse();
  if (files.length === 0) throw new DiffParseError('not_a_patch', null);
  return { files };
}

// Bounded digits and no nested quantifiers: linear time on any input.
const HUNK_HEADER = /^@@ -(\d{1,9})(?:,(\d{1,9}))? \+(\d{1,9})(?:,(\d{1,9}))? @@(.*)$/;
const GIT_HEADER_LINE = /^(?:old mode|new mode|similarity index|dissimilarity index|index) /;

class PatchParser {
  private readonly lines: readonly string[];
  private readonly limits: DiffLimits;
  private readonly files: DiffFile[] = [];
  private i = 0;
  private lineCount = 0;

  constructor(lines: readonly string[], limits: DiffLimits) {
    this.lines = lines;
    this.limits = limits;
  }

  parse(): DiffFile[] {
    while (this.i < this.lines.length) {
      if (this.isFileStart(this.i)) {
        if (this.files.length >= this.limits.maxFiles) {
          throw new DiffParseError('too_many_files', this.i + 1);
        }
        const isGit = this.lines[this.i]!.startsWith('diff --git ');
        this.files.push(isGit ? this.parseGitFile() : this.parsePlainFile());
      } else {
        // Commit messages, diffstats, "Index:" lines and other text between files.
        this.i++;
      }
    }
    return this.files;
  }

  private isFileStart(index: number): boolean {
    const line = this.lines[index];
    if (line === undefined) return false;
    return (
      line.startsWith('diff --git ') ||
      (line.startsWith('--- ') && this.lines[index + 1]?.startsWith('+++ ') === true)
    );
  }

  private parseGitFile(): DiffFile {
    const headerLine = this.i + 1;
    const fromHeader = parseGitHeaderPaths(this.lines[this.i]!.slice('diff --git '.length));
    this.i++;

    let added = false;
    let deleted = false;
    let copied = false;
    let isBinary = false;
    let renameFrom: string | undefined;
    let renameTo: string | undefined;
    let pair: { old: string | null; new: string | null } | undefined;
    let hunks: DiffHunk[] = [];

    while (this.i < this.lines.length) {
      const line = this.lines[this.i]!;
      if (line.startsWith('new file mode ')) added = true;
      else if (line.startsWith('deleted file mode ')) deleted = true;
      else if (line.startsWith('rename from ')) renameFrom = unquote(line.slice(12));
      else if (line.startsWith('rename to ')) renameTo = unquote(line.slice(10));
      else if (line.startsWith('copy from '))
        [copied, renameFrom] = [true, unquote(line.slice(10))];
      else if (line.startsWith('copy to ')) [copied, renameTo] = [true, unquote(line.slice(8))];
      else if (line.startsWith('Binary files ') && line.endsWith(' differ')) isBinary = true;
      else if (GIT_HEADER_LINE.test(line)) {
        // Modes and blob ids: nothing to show.
      } else if (line === 'GIT binary patch') {
        isBinary = true;
        while (this.i < this.lines.length && !this.lines[this.i]!.startsWith('diff --git ')) {
          this.i++;
        }
        break;
      } else if (line.startsWith('--- ')) {
        const raw = this.readPathPair();
        pair = { old: stripPrefix(raw.old, 'a/'), new: stripPrefix(raw.new, 'b/') };
        hunks = this.parseHunks();
        break;
      } else if (line.startsWith('@@')) {
        throw new DiffParseError('malformed_header', this.i + 1);
      } else {
        break;
      }
      this.i++;
    }

    // rename/copy lines and ---/+++ are unambiguous; the diff --git line is a fallback for
    // files with no hunks (mode changes, binaries, empty files).
    let oldPath = renameFrom ?? (pair ? pair.old : fromHeader?.old);
    let newPath = renameTo ?? (pair ? pair.new : fromHeader?.new);
    if (oldPath === undefined || newPath === undefined) {
      throw new DiffParseError('malformed_header', headerLine);
    }
    if (added && !copied) oldPath = null;
    if (deleted) newPath = null;

    let changeType: DiffFile['changeType'] = 'modified';
    if (oldPath === null || copied) changeType = 'added';
    else if (newPath === null) changeType = 'deleted';
    else if (renameFrom !== undefined || oldPath !== newPath) changeType = 'renamed';

    return buildFile(oldPath, newPath, changeType, isBinary, hunks);
  }

  private parsePlainFile(): DiffFile {
    const raw = this.readPathPair();
    const prefixed =
      (raw.old === null || raw.old.startsWith('a/')) &&
      (raw.new === null || raw.new.startsWith('b/'));
    const oldPath = prefixed ? stripPrefix(raw.old, 'a/') : raw.old;
    const newPath = prefixed ? stripPrefix(raw.new, 'b/') : raw.new;
    const hunks = this.parseHunks();

    // Plain diffs often compare differently named copies (x.orig, old/x), so a name
    // difference is not a rename.
    const changeType = oldPath === null ? 'added' : newPath === null ? 'deleted' : 'modified';
    return buildFile(oldPath, newPath, changeType, false, hunks);
  }

  private readPathPair(): { old: string | null; new: string | null } {
    const next = this.lines[this.i + 1];
    if (next === undefined || !next.startsWith('+++ ')) {
      throw new DiffParseError('malformed_header', this.i + 2);
    }
    const pair = {
      old: parseFilePath(this.lines[this.i]!.slice(4)),
      new: parseFilePath(next.slice(4)),
    };
    this.i += 2;
    return pair;
  }

  private parseHunks(): DiffHunk[] {
    const hunks: DiffHunk[] = [];
    while (this.lines[this.i]?.startsWith('@@')) hunks.push(this.parseHunk());

    // More diff lines straight after a hunk mean its header's counts were too small.
    // "-- " is the signature separator git format-patch writes after the last file.
    const next = this.lines[this.i];
    if (next !== undefined && /^[ +-]/.test(next) && next !== '-- ' && !this.isFileStart(this.i)) {
      throw new DiffParseError('count_mismatch', this.i + 1);
    }
    return hunks;
  }

  private parseHunk(): DiffHunk {
    const headerLine = this.i + 1;
    const header = this.lines[this.i]!;
    const match = HUNK_HEADER.exec(header);
    if (!match) throw new DiffParseError('malformed_hunk', headerLine);

    // An omitted count means 1: "@@ -3 +3 @@".
    const oldStart = Number(match[1]);
    const oldLines = match[2] === undefined ? 1 : Number(match[2]);
    const newStart = Number(match[3]);
    const newLines = match[4] === undefined ? 1 : Number(match[4]);
    if ((oldStart === 0 && oldLines > 0) || (newStart === 0 && newLines > 0)) {
      throw new DiffParseError('malformed_hunk', headerLine);
    }
    const rest = match[5]!.startsWith(' ') ? match[5]!.slice(1) : match[5]!;

    const lines: DiffLine[] = [];
    let oldNumber = oldStart;
    let newNumber = newStart;
    let oldLeft = oldLines;
    let newLeft = newLines;
    this.i++;

    // Driven by the header's counts, not by prefixes, so a removed "-- x" or an added
    // "++ y" is content, never mistaken for a file header.
    while (oldLeft > 0 || newLeft > 0) {
      const raw = this.lines[this.i];
      const lineNumber = this.i + 1;
      if (raw === undefined) throw new DiffParseError('count_mismatch', headerLine);
      if (raw.startsWith('\\')) {
        markNoNewline(lines, lineNumber);
        this.i++;
        continue;
      }

      // An empty line is a context line whose single space was stripped (editors, email).
      const prefix = raw === '' ? ' ' : raw[0];
      const line = { content: raw.slice(1), noNewlineAtEnd: false };
      if (prefix === ' ' && oldLeft > 0 && newLeft > 0) {
        lines.push({ type: 'context', ...line, oldNumber: oldNumber++, newNumber: newNumber++ });
        oldLeft--;
        newLeft--;
      } else if (prefix === '-' && oldLeft > 0) {
        lines.push({ type: 'del', ...line, oldNumber: oldNumber++, newNumber: null });
        oldLeft--;
      } else if (prefix === '+' && newLeft > 0) {
        lines.push({ type: 'add', ...line, oldNumber: null, newNumber: newNumber++ });
        newLeft--;
      } else {
        throw new DiffParseError('count_mismatch', lineNumber);
      }

      if (++this.lineCount > this.limits.maxLines) {
        throw new DiffParseError('too_many_lines', lineNumber);
      }
      this.i++;
    }

    while (this.lines[this.i]?.startsWith('\\')) {
      markNoNewline(lines, this.i + 1);
      this.i++;
    }

    return { header, oldStart, oldLines, newStart, newLines, section: rest || null, lines };
  }
}

function buildFile(
  oldPath: string | null,
  newPath: string | null,
  changeType: DiffFile['changeType'],
  isBinary: boolean,
  hunks: DiffHunk[],
): DiffFile {
  let additions = 0;
  let deletions = 0;
  for (const hunk of hunks) {
    for (const line of hunk.lines) {
      if (line.type === 'add') additions++;
      else if (line.type === 'del') deletions++;
    }
  }
  return { oldPath, newPath, changeType, isBinary, additions, deletions, hunks };
}

/** "\ No newline at end of file" (the text is translated in some locales). */
function markNoNewline(lines: DiffLine[], lineNumber: number): void {
  const previous = lines.at(-1);
  if (!previous) throw new DiffParseError('malformed_hunk', lineNumber);
  previous.noNewlineAtEnd = true;
}

function splitLines(text: string): string[] {
  const lines = text.split('\n');
  if (lines.at(-1) === '') lines.pop();
  return lines.map((line) => (line.endsWith('\r') ? line.slice(0, -1) : line));
}

function utf8Length(text: string): number {
  let bytes = 0;
  for (let k = 0; k < text.length; k++) {
    const code = text.charCodeAt(k);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    // A surrogate pair is 4 bytes in all, so 2 for each half.
    else if (code >= 0xd800 && code <= 0xdfff) bytes += 2;
    else bytes += 3;
  }
  return bytes;
}

/** The name from a "--- " or "+++ " line; null for /dev/null. */
function parseFilePath(raw: string): string | null {
  // A tab ends the name: GNU diff puts a timestamp after it, git does so for names with spaces.
  const tab = raw.indexOf('\t');
  const name = unquote(tab === -1 ? raw : raw.slice(0, tab));
  return name === '/dev/null' ? null : name;
}

function stripPrefix(path: string | null, prefix: string): string | null {
  return path !== null && path.startsWith(prefix) ? path.slice(prefix.length) : path;
}

/** Both names from `diff --git a/x b/y`, which is ambiguous when names contain spaces. */
function parseGitHeaderPaths(rest: string): { old: string; new: string } | null {
  let oldName: string;
  let newName: string;
  if (rest.startsWith('"')) {
    const end = closingQuote(rest);
    if (end === -1 || rest[end + 1] !== ' ') return null;
    oldName = unquote(rest.slice(0, end + 1));
    newName = unquote(rest.slice(end + 2));
  } else if (rest.endsWith('"')) {
    const start = rest.lastIndexOf(' "');
    if (start === -1) return null;
    oldName = rest.slice(0, start);
    newName = unquote(rest.slice(start + 1));
  } else {
    // Without a rename both halves name the same file, so try splitting in the middle.
    const half = (rest.length - 1) / 2;
    const left = rest.slice(0, half);
    const right = rest.slice(half + 1);
    if (Number.isInteger(half) && rest[half] === ' ' && left.slice(2) === right.slice(2)) {
      [oldName, newName] = [left, right];
    } else {
      const split = rest.indexOf(' b/');
      if (split === -1) return null;
      [oldName, newName] = [rest.slice(0, split), rest.slice(split + 1)];
    }
  }
  return { old: stripPrefix(oldName, 'a/')!, new: stripPrefix(newName, 'b/')! };
}

function closingQuote(text: string): number {
  for (let k = 1; k < text.length; k++) {
    if (text[k] === '\\') k++;
    else if (text[k] === '"') return k;
  }
  return -1;
}

const ESCAPES: Record<string, number> = {
  a: 7,
  b: 8,
  t: 9,
  n: 10,
  v: 11,
  f: 12,
  r: 13,
  '"': 34,
  '\\': 92,
};
const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Undoes git's C-style quoting; octal escapes are UTF-8 bytes ("caf\303\251"). */
function unquote(name: string): string {
  if (name.length < 2 || !name.startsWith('"') || !name.endsWith('"')) return name;
  const chars = Array.from(name.slice(1, -1));
  const bytes: number[] = [];
  for (let k = 0; k < chars.length; k++) {
    const char = chars[k]!;
    if (char === '\\' && k + 1 < chars.length) {
      const octal = chars.slice(k + 1, k + 4).join('');
      if (/^[0-7]{3}$/.test(octal)) {
        bytes.push(parseInt(octal, 8) & 0xff);
        k += 3;
        continue;
      }
      const escaped = ESCAPES[chars[k + 1]!];
      if (escaped !== undefined) {
        bytes.push(escaped);
        k++;
        continue;
      }
    }
    bytes.push(...encoder.encode(char));
  }
  return decoder.decode(new Uint8Array(bytes));
}
