import { describe, expect, it } from 'vitest';
import {
  canEditReview,
  CreateReviewRequestSchema,
  ListReviewsQuerySchema,
  REVIEW_STATUSES,
  ReviewFileSchema,
  ReviewSchema,
  ReviewStatusSchema,
  UpdateReviewRequestSchema,
} from './reviews.js';
import type { WorkspaceRole } from './workspaces.js';

const valid = { title: 'Fix login', patch: '--- a/x\n+++ b/x\n' };

describe('CreateReviewRequestSchema', () => {
  it('trims the title and turns a missing, null or blank description into null', () => {
    for (const description of [undefined, null, '', '   ']) {
      expect(
        CreateReviewRequestSchema.parse({ ...valid, title: '  Fix login  ', description }),
      ).toEqual({ title: 'Fix login', description: null, patch: valid.patch });
    }
  });

  it('trims the description', () => {
    expect(CreateReviewRequestSchema.parse({ ...valid, description: '  Why  ' }).description).toBe(
      'Why',
    );
  });

  it('keeps the patch exactly as sent', () => {
    const patch = '  diff --git a/x b/x\r\n';
    expect(CreateReviewRequestSchema.parse({ ...valid, patch }).patch).toBe(patch);
  });

  it.each([
    ['an empty title', { title: '' }],
    ['a blank title', { title: '   ' }],
    ['a 201-character title', { title: 'x'.repeat(201) }],
    ['a 10,001-character description', { description: 'x'.repeat(10_001) }],
    ['an empty patch', { patch: '' }],
    ['a missing patch', { patch: undefined }],
    ['a non-string patch', { patch: 42 }],
    ['a NUL in the title', { title: 'Fix\0login' }],
    ['a NUL in the description', { description: 'a\0b' }],
  ])('rejects %s', (_, overrides) => {
    expect(CreateReviewRequestSchema.safeParse({ ...valid, ...overrides }).success).toBe(false);
  });

  it('accepts the maximum lengths', () => {
    const result = CreateReviewRequestSchema.safeParse({
      ...valid,
      title: 'x'.repeat(200),
      description: 'x'.repeat(10_000),
    });
    expect(result.success).toBe(true);
  });
});

describe('review response schemas', () => {
  const review = {
    id: '01a17e5e-aa56-7985-be46-bf5f1c7e7fd0',
    workspaceId: '01a17e5e-aa56-7985-be46-bf5f1c7e7fd1',
    number: 1,
    title: 'Fix login',
    description: null,
    status: 'open',
    author: { id: '01a17e5e-aa56-7985-be46-bf5f1c7e7fd2', displayName: 'Ada' },
    filesChanged: 1,
    additions: 2,
    deletions: 0,
    createdAt: '2026-10-31T10:00:00.000Z',
  };

  it('accepts a review, also with a deleted author', () => {
    expect(ReviewSchema.parse(review)).toEqual(review);
    expect(ReviewSchema.parse({ ...review, author: null }).author).toBeNull();
  });

  it('allows only the review statuses', () => {
    expect(REVIEW_STATUSES).toEqual(['open', 'closed']);
    expect(ReviewStatusSchema.safeParse('merged').success).toBe(false);
  });

  it('describes a file without hunks', () => {
    const file = {
      id: '01a17e5e-aa56-7985-be46-bf5f1c7e7fd3',
      position: 0,
      oldPath: null,
      newPath: 'a.txt',
      changeType: 'added',
      isBinary: false,
      additions: 1,
      deletions: 0,
    };
    expect(ReviewFileSchema.parse({ ...file, hunks: [] })).toEqual(file);
  });
});

describe('UpdateReviewRequestSchema', () => {
  it('keeps only the fields that are sent', () => {
    expect(UpdateReviewRequestSchema.parse({ title: '  New  ' })).toEqual({ title: 'New' });
    expect(UpdateReviewRequestSchema.parse({ status: 'closed' })).toEqual({ status: 'closed' });
  });

  it('clears the description with null or a blank string', () => {
    for (const description of [null, '', '  ']) {
      expect(UpdateReviewRequestSchema.parse({ description })).toEqual({ description: null });
    }
  });

  it.each([
    ['an empty body', {}],
    ['only unknown fields', { patch: 'x' }],
    ['only undefined fields', { title: undefined }],
    ['a blank title', { title: '  ' }],
    ['a null title', { title: null }],
    ['an unknown status', { status: 'merged' }],
    ['a NUL in the title', { title: 'a\0' }],
  ])('rejects %s', (_, body) => {
    expect(UpdateReviewRequestSchema.safeParse(body).success).toBe(false);
  });
});

describe('ListReviewsQuerySchema', () => {
  it('defaults limit to 20 and leaves the filters unset', () => {
    expect(ListReviewsQuerySchema.parse({})).toEqual({ limit: 20 });
  });

  it('coerces limit from the query string and accepts author "me" or a uuid', () => {
    const author = '01a17e5e-aa56-7985-be46-bf5f1c7e7fd2';
    expect(ListReviewsQuerySchema.parse({ limit: '50', status: 'open', author })).toEqual({
      limit: 50,
      status: 'open',
      author,
    });
    expect(ListReviewsQuerySchema.parse({ author: 'me' }).author).toBe('me');
  });

  it.each([
    { limit: '0' },
    { limit: '51' },
    { limit: '1.5' },
    { limit: 'ten' },
    { limit: '' },
    { status: 'merged' },
    { status: ['open', 'closed'] },
    { author: 'someone' },
  ])('rejects %j', (query) => {
    expect(ListReviewsQuerySchema.safeParse(query).success).toBe(false);
  });
});

describe('canEditReview', () => {
  const me = '01a17e5e-aa56-7985-be46-bf5f1c7e7fd2';
  const mine = { author: { id: me, displayName: 'Me' } };
  const theirs = { author: { id: '01a17e5e-aa56-7985-be46-bf5f1c7e7fd9', displayName: 'Them' } };
  const orphaned = { author: null };

  it.each<[WorkspaceRole, boolean, boolean, boolean]>([
    // role, own review, someone else's, author deleted
    ['viewer', false, false, false],
    ['member', true, false, false],
    ['admin', true, true, true],
    ['owner', true, true, true],
  ])('%s: own %s, other %s, orphaned %s', (role, own, other, none) => {
    expect(canEditReview(role, me, mine)).toBe(own);
    expect(canEditReview(role, me, theirs)).toBe(other);
    expect(canEditReview(role, me, orphaned)).toBe(none);
  });
});
