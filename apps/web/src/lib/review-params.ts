import type { ReviewStatus } from '@diffcraft/shared';
import { z } from 'zod';

// Same rule as the API: a positive int4, written without leading zeros.
const REVIEW_NUMBER_PATTERN = /^[1-9]\d{0,9}$/;
const MAX_REVIEW_NUMBER = 2_147_483_647;

// Only UUIDs go in API paths: encodeURIComponent leaves "." and "..", which new URL() would resolve elsewhere.
export const isUuid = (id: string): boolean => z.uuid().safeParse(id).success;

export function isReviewNumber(value: string): boolean {
  return REVIEW_NUMBER_PATTERN.test(value) && Number(value) <= MAX_REVIEW_NUMBER;
}

export interface ReviewFilters {
  status: ReviewStatus | null;
  mine: boolean;
  reviewing: boolean;
}

type SearchParams = Record<string, string | string[] | undefined>;

export function parseReviewFilters(searchParams: SearchParams): ReviewFilters {
  const { status, mine, reviewer } = searchParams;
  return {
    status: status === 'open' || status === 'closed' || status === 'merged' ? status : null,
    mine: mine === '1',
    reviewing: reviewer === 'me',
  };
}

export function reviewListQuery(filters: ReviewFilters, cursor?: string | null): string {
  const query = new URLSearchParams();
  if (filters.status) query.set('status', filters.status);
  if (filters.mine) query.set('author', 'me');
  if (filters.reviewing) query.set('reviewer', 'me');
  if (cursor) query.set('cursor', cursor);
  const text = query.toString();
  return text ? `?${text}` : '';
}

export function reviewsPageHref(workspaceId: string, filters: ReviewFilters): string {
  const query = new URLSearchParams();
  if (filters.status) query.set('status', filters.status);
  if (filters.mine) query.set('mine', '1');
  if (filters.reviewing) query.set('reviewer', 'me');
  const text = query.toString();
  return `/workspaces/${workspaceId}/reviews${text ? `?${text}` : ''}`;
}
