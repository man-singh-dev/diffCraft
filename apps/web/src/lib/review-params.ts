import type { ReviewStatus } from '@diffcraft/shared';

// Same rule as the API: a positive int4, written without leading zeros.
const REVIEW_NUMBER_PATTERN = /^[1-9]\d{0,9}$/;
const MAX_REVIEW_NUMBER = 2_147_483_647;

/** Whether a URL segment can be a review number; anything else is a 404 without an API call. */
export function isReviewNumber(value: string): boolean {
  return REVIEW_NUMBER_PATTERN.test(value) && Number(value) <= MAX_REVIEW_NUMBER;
}

export interface ReviewFilters {
  status: ReviewStatus | null;
  mine: boolean;
}

type SearchParams = Record<string, string | string[] | undefined>;

/** The list filters from the page URL. Unknown or repeated values are ignored. */
export function parseReviewFilters(searchParams: SearchParams): ReviewFilters {
  const { status, mine } = searchParams;
  return {
    status: status === 'open' || status === 'closed' ? status : null,
    mine: mine === '1',
  };
}

/** Query string for GET /reviews, with a leading "?" or empty. */
export function reviewListQuery(filters: ReviewFilters, cursor?: string | null): string {
  const query = new URLSearchParams();
  if (filters.status) query.set('status', filters.status);
  if (filters.mine) query.set('author', 'me');
  if (cursor) query.set('cursor', cursor);
  const text = query.toString();
  return text ? `?${text}` : '';
}

/** Link to the reviews page with these filters. */
export function reviewsPageHref(workspaceId: string, filters: ReviewFilters): string {
  const query = new URLSearchParams();
  if (filters.status) query.set('status', filters.status);
  if (filters.mine) query.set('mine', '1');
  const text = query.toString();
  return `/workspaces/${workspaceId}/reviews${text ? `?${text}` : ''}`;
}
