import type { DiffLine, Thread } from '@diffcraft/shared';

export type LineSide = 'old' | 'new';

/** Where a new line thread goes: a line on one side of a file. */
export interface LineTarget {
  fileId: string;
  side: LineSide;
  line: number;
}

/** The key threads are grouped by: one line on one side of one file. */
export const threadKey = (fileId: string, side: LineSide, line: number): string =>
  `${fileId}:${side}:${line}`;

export const targetKey = (target: LineTarget): string =>
  threadKey(target.fileId, target.side, target.line);

/** Line threads grouped by key, in the order given (the API's: oldest first per line). */
export function groupThreadsByKey(threads: Thread[]): Map<string, Thread[]> {
  const groups = new Map<string, Thread[]>();
  for (const thread of threads) {
    if (!thread.anchor) continue;
    const key = threadKey(thread.anchor.fileId, thread.anchor.side, thread.anchor.line);
    const group = groups.get(key);
    if (group) group.push(thread);
    else groups.set(key, [thread]);
  }
  return groups;
}

type RowLine = Pick<DiffLine, 'type' | 'oldNumber' | 'newNumber'>;

/**
 * The keys a unified row shows threads for. A context line exists on both sides, so it matches a
 * thread anchored on either (e.g. one started on the old side in the split view).
 */
export function unifiedRowKeys(fileId: string, row: RowLine): string[] {
  const keys: string[] = [];
  if (row.type !== 'add' && row.oldNumber !== null)
    keys.push(threadKey(fileId, 'old', row.oldNumber));
  if (row.type !== 'del' && row.newNumber !== null)
    keys.push(threadKey(fileId, 'new', row.newNumber));
  return keys;
}

/** Where "+" on a unified row starts a thread: deleted lines on the old side, the rest on the new. */
export function unifiedRowTarget(fileId: string, row: RowLine): LineTarget | null {
  const side: LineSide = row.type === 'del' ? 'old' : 'new';
  const line = side === 'old' ? row.oldNumber : row.newNumber;
  return line === null ? null : { fileId, side, line };
}

/** In the split view each cell is one side: the left (old) or right (new) half of a row. */
export function splitCellTarget(fileId: string, side: LineSide, number: number): LineTarget {
  return { fileId, side, line: number };
}

/** Open line threads, in the API's order (by file, side and line). */
export const openLineThreads = (threads: Thread[]): Thread[] =>
  threads.filter((t) => t.anchor !== null && t.status === 'open');
