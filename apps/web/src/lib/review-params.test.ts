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
  it('reads status, mine and reviewer', () => {
    expect(parseReviewFilters({ status: 'open', mine: '1' })).toEqual({
      status: 'open',
      mine: true,
      reviewing: false,
    });
    expect(parseReviewFilters({ status: 'closed' })).toEqual({
      status: 'closed',
      mine: false,
      reviewing: false,
    });
    expect(parseReviewFilters({ status: 'merged', reviewer: 'me' })).toEqual({
      status: 'merged',
      mine: false,
      reviewing: true,
    });
  });

  it.each([
    {},
    { status: 'OPEN' },
    { status: ['open', 'closed'] },
    { mine: 'true' },
    { mine: ['1', '1'] },
    { reviewer: '01a17e5e-aa56-7985-be46-bf5f1c7e7fd0' },
    { reviewer: ['me', 'me'] },
  ])('ignores invalid values in %j', (params) => {
    expect(parseReviewFilters(params)).toEqual({ status: null, mine: false, reviewing: false });
  });
});

describe('reviewListQuery and reviewsPageHref', () => {
  it('sends mine to the API as author=me and adds the cursor', () => {
    expect(reviewListQuery({ status: null, mine: false, reviewing: false })).toBe('');
    expect(reviewListQuery({ status: 'open', mine: true, reviewing: false }, 'abc_-1')).toBe(
      '?status=open&author=me&cursor=abc_-1',
    );
    expect(reviewListQuery({ status: 'merged', mine: true, reviewing: true }, 'c')).toBe(
      '?status=merged&author=me&reviewer=me&cursor=c',
    );
  });

  it('builds page links with the filters', () => {
    const id = '01a17e5e-aa56-7985-be46-bf5f1c7e7fd0';
    expect(reviewsPageHref(id, { status: null, mine: false, reviewing: false })).toBe(
      `/workspaces/${id}/reviews`,
    );
    expect(reviewsPageHref(id, { status: 'closed', mine: true, reviewing: false })).toBe(
      `/workspaces/${id}/reviews?status=closed&mine=1`,
    );
    expect(reviewsPageHref(id, { status: 'open', mine: false, reviewing: true })).toBe(
      `/workspaces/${id}/reviews?status=open&reviewer=me`,
    );
  });
});
