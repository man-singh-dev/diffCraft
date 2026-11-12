import type { DiffHunk } from '@diffcraft/shared';
import type { ReviewFileRow } from '../../db/schema/index.js';
import { redactLine, redactLines } from './redact.js';

export interface ContextLimits {
  maxChangedLines: number;
  maxFileChangedLines: number;
  maxLineLength: number;
}

export const DEFAULT_CONTEXT_LIMITS: ContextLimits = {
  maxChangedLines: 1_500,
  maxFileChangedLines: 1_000,
  maxLineLength: 1_000,
};

const LOCKFILES = new Set([
  'pnpm-lock.yaml',
  'package-lock.json',
  'npm-shrinkwrap.json',
  'yarn.lock',
  'bun.lock',
  'bun.lockb',
  'cargo.lock',
  'gemfile.lock',
  'poetry.lock',
  'pipfile.lock',
  'uv.lock',
  'composer.lock',
  'go.sum',
  'packages.lock.json',
  'podfile.lock',
  'pubspec.lock',
  'mix.lock',
  'flake.lock',
]);

const MINIFIED_PATH = /\.min\.(?:js|mjs|cjs|css)$|\.(?:js|css)\.map$/i;

export type SkipReason =
  'binary' | 'deleted' | 'lockfile' | 'minified' | 'too_large' | 'no_changes' | 'over_budget';

export interface AnalyzedFile {
  id: string;
  path: string;
  oldPath: string | null;
  newPath: string | null;
  changeType: ReviewFileRow['changeType'];
  hunks: DiffHunk[];
}

export interface AnalysisContext {
  files: AnalyzedFile[];
  skipped: { path: string; reason: SkipReason }[];
  totalFiles: number;
  changedLines: number;
  truncated: boolean;
}

const pathOf = (file: Pick<ReviewFileRow, 'newPath' | 'oldPath'>) =>
  file.newPath ?? file.oldPath ?? '';

function skipReason(file: ReviewFileRow, limits: ContextLimits): SkipReason | null {
  if (file.isBinary) return 'binary';
  if (file.changeType === 'deleted') return 'deleted';
  const path = pathOf(file);
  const name = path.slice(path.lastIndexOf('/') + 1).toLowerCase();
  if (LOCKFILES.has(name)) return 'lockfile';
  if (MINIFIED_PATH.test(path)) return 'minified';
  const changed = file.additions + file.deletions;
  if (changed === 0) return 'no_changes';
  if (changed > limits.maxFileChangedLines) return 'too_large';
  const longLine = file.hunks.some((hunk) =>
    hunk.lines.some((line) => line.content.length > limits.maxLineLength),
  );
  if (longLine) return 'minified';
  return null;
}

function redactHunks(hunks: readonly DiffHunk[]): DiffHunk[] {
  const redacted = redactLines(hunks.flatMap((hunk) => hunk.lines.map((line) => line.content)));
  let index = 0;
  return hunks.map((hunk) => ({
    ...hunk,
    section: hunk.section === null ? null : redactLine(hunk.section),
    lines: hunk.lines.map((line) => ({ ...line, content: redacted[index++]! })),
  }));
}

// Files in review order until the budget runs out: one model call per job keeps within free-tier rate limits.
export function buildContext(
  rows: readonly ReviewFileRow[],
  limits: ContextLimits = DEFAULT_CONTEXT_LIMITS,
): AnalysisContext {
  const ordered = [...rows].sort((a, b) => a.position - b.position);
  const context: AnalysisContext = {
    files: [],
    skipped: [],
    totalFiles: rows.length,
    changedLines: 0,
    truncated: false,
  };
  for (const file of ordered) {
    const path = pathOf(file);
    const reason = skipReason(file, limits);
    if (reason) {
      context.skipped.push({ path, reason });
      continue;
    }
    const changed = file.additions + file.deletions;
    if (context.truncated || context.changedLines + changed > limits.maxChangedLines) {
      context.truncated = true;
      context.skipped.push({ path, reason: 'over_budget' });
      continue;
    }
    context.changedLines += changed;
    context.files.push({
      id: file.id,
      path,
      oldPath: file.oldPath,
      newPath: file.newPath,
      changeType: file.changeType,
      hunks: redactHunks(file.hunks),
    });
  }
  return context;
}
