import type { ReviewFileDiff } from '@diffcraft/shared';
import { parsePatch } from '@diffcraft/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServerApiResult } from './api.server.js';

// server-only throws outside a React Server Components build.
vi.mock('server-only', () => ({}));
const getReviewFileDiff =
  vi.fn<(w: string, n: string, f: string) => Promise<ServerApiResult<ReviewFileDiff>>>();
vi.mock('./api.server', () => ({ getReviewFileDiff }));

const { loadFileDiff } = await import('./diff-actions.js');

const WORKSPACE = '3f2b8c1e-5d4a-4e6b-9c7d-1a2b3c4d5e6f';
const FILE = '01a17e5e-aa56-7985-be46-bf5f1c7e7fd0';

const hunks = parsePatch('--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-const a = 1;\n+const a = 2;\n')
  .files[0]!.hunks;
const diff: ReviewFileDiff = {
  file: {
    id: FILE,
    position: 0,
    oldPath: 'a.ts',
    newPath: 'a.ts',
    changeType: 'modified',
    isBinary: false,
    additions: 1,
    deletions: 1,
  },
  hunks,
};

beforeEach(() => {
  getReviewFileDiff.mockReset();
});

describe('loadFileDiff', () => {
  it.each([
    ['workspace id not a uuid', ['nope', '1', FILE, 'unified']],
    ['workspace id with a path', [`../${WORKSPACE}`, '1', FILE, 'unified']],
    ['review number with a leading zero', [WORKSPACE, '01', FILE, 'unified']],
    ['review number over int4', [WORKSPACE, '2147483648', FILE, 'unified']],
    ['review number as a number', [WORKSPACE, 1, FILE, 'unified']],
    ['file id not a uuid', [WORKSPACE, '1', `${FILE}/../x`, 'unified']],
    ['file id missing', [WORKSPACE, '1', undefined, 'unified']],
    ['unknown view', [WORKSPACE, '1', FILE, 'sideways']],
    ['view as an object', [WORKSPACE, '1', FILE, { view: 'split' }]],
  ])('%s: not_found without calling the API', async (_name, args) => {
    const [w, n, f, v] = args as unknown[];
    expect(await loadFileDiff(w, n, f, v)).toEqual({ ok: false, error: 'not_found' });
    expect(getReviewFileDiff).not.toHaveBeenCalled();
  });

  it.each([
    [401, 'unauthorized'],
    [403, 'failed'],
    [404, 'not_found'],
    [500, 'failed'],
    [0, 'failed'],
  ] as const)('API status %d → %s', async (status, error) => {
    getReviewFileDiff.mockResolvedValue({ ok: false, status });
    expect(await loadFileDiff(WORKSPACE, '3', FILE, 'unified')).toEqual({ ok: false, error });
    expect(getReviewFileDiff).toHaveBeenCalledWith(WORKSPACE, '3', FILE);
  });

  it.each(['unified', 'split'] as const)('returns highlighted %s rows', async (view) => {
    getReviewFileDiff.mockResolvedValue({ ok: true, data: diff });
    const result = await loadFileDiff(WORKSPACE, '3', FILE, view);
    expect(result.ok && result.diff.view).toBe(view);
    expect(result.ok && result.diff.rows.length).toBeGreaterThan(0);
  });
});
