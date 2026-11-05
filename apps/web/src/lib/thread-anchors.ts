import type { DiffLine, Thread } from '@diffcraft/shared';

export type LineSide = 'old' | 'new';

export interface LineTarget {
  fileId: string;
  side: LineSide;
  line: number;
}

export const threadKey = (fileId: string, side: LineSide, line: number): string =>
  `${fileId}:${side}:${line}`;

export const targetKey = (target: LineTarget): string =>
  threadKey(target.fileId, target.side, target.line);

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

// A context line exists on both sides, so it matches a thread anchored on either.
export function unifiedRowKeys(fileId: string, row: RowLine): string[] {
  const keys: string[] = [];
  if (row.type !== 'add' && row.oldNumber !== null)
    keys.push(threadKey(fileId, 'old', row.oldNumber));
  if (row.type !== 'del' && row.newNumber !== null)
    keys.push(threadKey(fileId, 'new', row.newNumber));
  return keys;
}

export function unifiedRowTarget(fileId: string, row: RowLine): LineTarget | null {
  const side: LineSide = row.type === 'del' ? 'old' : 'new';
  const line = side === 'old' ? row.oldNumber : row.newNumber;
  return line === null ? null : { fileId, side, line };
}

export function splitCellTarget(fileId: string, side: LineSide, number: number): LineTarget {
  return { fileId, side, line: number };
}

export const openLineThreads = (threads: Thread[]): Thread[] =>
  threads.filter((t) => t.anchor !== null && t.status === 'open');
