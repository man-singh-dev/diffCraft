import { parseLineAnchor, type ReviewFile } from '@diffcraft/shared';
import { isUuid } from './review-params';

export const DIFF_VIEWS = ['unified', 'split'] as const;
export type DiffView = (typeof DIFF_VIEWS)[number];

export const EAGER_FILE_COUNT = 5;
export const EAGER_MAX_CHANGED_LINES = 400;

type SearchParams = Record<string, string | string[] | undefined>;

export const isDiffView = (value: unknown): value is DiffView =>
  value === 'unified' || value === 'split';

export function parseDiffView(searchParams: SearchParams): DiffView {
  return searchParams.view === 'split' ? 'split' : 'unified';
}

export function filesPageHref(
  workspaceId: string,
  reviewNumber: number | string,
  searchParams: SearchParams,
  view: DiffView,
): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (key === 'view' || value === undefined) continue;
    for (const v of Array.isArray(value) ? value : [value]) query.append(key, v);
  }
  if (view === 'split') query.set('view', 'split');
  const text = query.toString();
  return `/workspaces/${workspaceId}/reviews/${reviewNumber}/files${text ? `?${text}` : ''}`;
}

export function eagerFileIds(
  files: Pick<ReviewFile, 'id' | 'isBinary' | 'additions' | 'deletions'>[],
): Set<string> {
  const ids = new Set<string>();
  for (const file of files) {
    if (ids.size === EAGER_FILE_COUNT) break;
    const changed = file.additions + file.deletions;
    if (!file.isBinary && changed > 0 && changed <= EAGER_MAX_CHANGED_LINES) ids.add(file.id);
  }
  return ids;
}

export const fileSectionId = (fileId: string) => `file-${fileId}`;

export interface HashTarget {
  fileId: string;
  elementId: string;
}

export function parseHashTarget(hash: string): HashTarget | null {
  const elementId = hash.startsWith('#') ? hash.slice(1) : hash;
  if (elementId.startsWith('file-')) {
    const fileId = elementId.slice('file-'.length);
    return isUuid(fileId) ? { fileId, elementId } : null;
  }
  const anchor = parseLineAnchor(elementId);
  return anchor ? { fileId: anchor.fileId, elementId } : null;
}
