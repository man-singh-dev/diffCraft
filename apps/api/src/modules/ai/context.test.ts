import { randomUUID } from 'node:crypto';
import type { DiffHunk } from '@diffcraft/shared';
import { describe, expect, it } from 'vitest';
import type { ReviewFileRow } from '../../db/schema/index.js';
import { buildContext } from './context.js';

let position = 0;

function file(path: string, overrides: Partial<ReviewFileRow> = {}): ReviewFileRow {
  const added = overrides.additions ?? 1;
  const hunk: DiffHunk = {
    header: `@@ -0,0 +1,${added} @@`,
    oldStart: 0,
    oldLines: 0,
    newStart: 1,
    newLines: added,
    section: null,
    lines: Array.from({ length: added }, (_, i) => ({
      type: 'add' as const,
      content: `line ${i + 1}`,
      oldNumber: null,
      newNumber: i + 1,
      noNewlineAtEnd: false,
    })),
  };
  return {
    id: randomUUID(),
    reviewId: randomUUID(),
    position: position++,
    oldPath: path,
    newPath: path,
    changeType: 'modified',
    isBinary: false,
    additions: added,
    deletions: 0,
    hunks: [hunk],
    ...overrides,
  };
}

describe('buildContext', () => {
  it('skips binary, deleted, lockfiles, minified, unchanged and very large files', () => {
    const context = buildContext([
      file('src/ok.ts'),
      file('logo.png', { isBinary: true, hunks: [], additions: 0 }),
      file('src/old.ts', { changeType: 'deleted', newPath: null }),
      file('pnpm-lock.yaml'),
      file('packages/a/package-lock.json'),
      file('yarn.lock'),
      file('Cargo.lock'),
      file('dist/app.min.js'),
      file('src/mode-only.sh', { additions: 0, hunks: [] }),
      file('src/huge.ts', { additions: 1_200 }),
    ]);
    expect(context.files.map((f) => f.path)).toEqual(['src/ok.ts']);
    expect(context.skipped).toEqual([
      { path: 'logo.png', reason: 'binary' },
      { path: 'src/old.ts', reason: 'deleted' },
      { path: 'pnpm-lock.yaml', reason: 'lockfile' },
      { path: 'packages/a/package-lock.json', reason: 'lockfile' },
      { path: 'yarn.lock', reason: 'lockfile' },
      { path: 'Cargo.lock', reason: 'lockfile' },
      { path: 'dist/app.min.js', reason: 'minified' },
      { path: 'src/mode-only.sh', reason: 'no_changes' },
      { path: 'src/huge.ts', reason: 'too_large' },
    ]);
    expect(context.truncated).toBe(false);
  });

  it('treats a file with a very long line as minified', () => {
    const minified = file('public/bundle.js');
    minified.hunks[0]!.lines[0]!.content = 'x'.repeat(5_000);
    expect(buildContext([minified]).skipped).toEqual([
      { path: 'public/bundle.js', reason: 'minified' },
    ]);
  });

  it('takes files in review order until the changed-line budget runs out', () => {
    const rows = [
      file('c.ts', { position: 2, additions: 600 }),
      file('a.ts', { position: 0, additions: 600 }),
      file('b.ts', { position: 1, additions: 600 }),
      file('d.ts', { position: 3, additions: 10 }),
    ];
    const context = buildContext(rows);
    expect(context.files.map((f) => f.path)).toEqual(['a.ts', 'b.ts']);
    expect(context.changedLines).toBe(1_200);
    expect(context.truncated).toBe(true);
    expect(context.totalFiles).toBe(4);
    expect(context.skipped).toEqual([
      { path: 'c.ts', reason: 'over_budget' },
      { path: 'd.ts', reason: 'over_budget' },
    ]);
  });

  it('redacts secrets in the lines it keeps, without changing line numbers', () => {
    const secret = file('config.ts', { additions: 2 });
    secret.hunks[0]!.lines[0]!.content = 'const apiKey = "abc123secret";';
    secret.hunks[0]!.lines[1]!.content = 'const region = "eu";';
    const [kept] = buildContext([secret]).files;
    expect(kept!.hunks[0]!.lines.map((l) => [l.newNumber, l.content])).toEqual([
      [1, 'const apiKey = "[REDACTED]";'],
      [2, 'const region = "eu";'],
    ]);
    expect(secret.hunks[0]!.lines[0]!.content).toContain('abc123secret');
  });
});
