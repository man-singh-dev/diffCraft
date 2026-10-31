import { describe, expect, it } from 'vitest';
import {
  CreateReviewRequestSchema,
  REVIEW_STATUSES,
  ReviewFileSchema,
  ReviewSchema,
  ReviewStatusSchema,
} from './reviews.js';

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
