import { describe, expect, it } from 'vitest';
import {
  isReviewNumber,
  parseReviewFilters,
  reviewListQuery,
  reviewsPageHref,
} from './review-params.js';

describe('isReviewNumber', () => {
  it.each(['1', '42', '2147483647'])('accepts %j', (value) => {
    expect(isReviewNumber(value)).toBe(true);
  });

  it.each(['', '0', '01', '-1', '1.5', '1e3', ' 1', 'abc', '..', '2147483648', '99999999999'])(
    'rejects %j',
    (value) => {
      expect(isReviewNumber(value)).toBe(false);
    },
  );
});

describe('parseReviewFilters', () => {
  it('reads status and mine', () => {
    expect(parseReviewFilters({ status: 'open', mine: '1' })).toEqual({
      status: 'open',
      mine: true,
    });
    expect(parseReviewFilters({ status: 'closed' })).toEqual({ status: 'closed', mine: false });
  });

  it.each([
    {},
    { status: 'merged' },
    { status: 'OPEN' },
    { status: ['open', 'closed'] },
    { mine: 'true' },
    { mine: ['1', '1'] },
  ])('ignores invalid values in %j', (params) => {
    expect(parseReviewFilters(params)).toEqual({ status: null, mine: false });
  });
});

describe('reviewListQuery and reviewsPageHref', () => {
  it('sends mine to the API as author=me and adds the cursor', () => {
    expect(reviewListQuery({ status: null, mine: false })).toBe('');
    expect(reviewListQuery({ status: 'open', mine: true }, 'abc_-1')).toBe(
      '?status=open&author=me&cursor=abc_-1',
    );
  });

  it('builds page links with the filters', () => {
    const id = '01a17e5e-aa56-7985-be46-bf5f1c7e7fd0';
    expect(reviewsPageHref(id, { status: null, mine: false })).toBe(`/workspaces/${id}/reviews`);
    expect(reviewsPageHref(id, { status: 'closed', mine: true })).toBe(
      `/workspaces/${id}/reviews?status=closed&mine=1`,
    );
  });
});
