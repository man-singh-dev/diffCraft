import { parseLineAnchor, type ReviewFile } from '@diffcraft/shared';
import { isUuid } from './review-params';

export const DIFF_VIEWS = ['unified', 'split'] as const;
export type DiffView = (typeof DIFF_VIEWS)[number];

/** How many files are rendered on the server with the page; the rest wait for "Load diff". */
export const EAGER_FILE_COUNT = 5;
/** Files with more changed lines (additions + deletions) than this are always loaded on demand. */
export const EAGER_MAX_CHANGED_LINES = 400;

type SearchParams = Record<string, string | string[] | undefined>;

export const isDiffView = (value: unknown): value is DiffView =>
  value === 'unified' || value === 'split';

/** The view from the URL: "split" for ?view=split, otherwise unified. */
export function parseDiffView(searchParams: SearchParams): DiffView {
  return searchParams.view === 'split' ? 'split' : 'unified';
}

/** Link to the files page in `view`, keeping the other query parameters. */
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

/** Ids of the files rendered with the page: the first few small, non-binary files with hunks to show. */
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

/** The id of a file's section on the files page. */
export const fileSectionId = (fileId: string) => `file-${fileId}`;

export interface HashTarget {
  fileId: string;
  /** The element id to scroll to: a file section or a line row. */
  elementId: string;
}

/** What a URL hash ("#file-<id>" or a line anchor) points at, or null if it's neither. */
export function parseHashTarget(hash: string): HashTarget | null {
  const elementId = hash.startsWith('#') ? hash.slice(1) : hash;
  if (elementId.startsWith('file-')) {
    const fileId = elementId.slice('file-'.length);
    return isUuid(fileId) ? { fileId, elementId } : null;
  }
  const anchor = parseLineAnchor(elementId);
  return anchor ? { fileId: anchor.fileId, elementId } : null;
}
