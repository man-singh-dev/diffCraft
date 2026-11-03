import { describe, expect, it } from 'vitest';
import {
  canComment,
  canDeleteComment,
  canEditComment,
  canResolveThread,
  CommentBodySchema,
  CreateThreadRequestSchema,
  SetThreadStatusRequestSchema,
  ThreadSchema,
} from './comments.js';
import type { WorkspaceRole } from './workspaces.js';

const ME = '3f2b8c1e-5d4a-4e6b-9c7d-1a2b3c4d5e6f';
const OTHER = '01a17e5e-aa56-7985-be46-bf5f1c7e7fd0';
const FILE = '01a17e5e-aa56-7985-be46-bf5f1c7e7fd1';
const ROLES: WorkspaceRole[] = ['owner', 'admin', 'member', 'viewer'];
const user = (id: string) => ({ id, displayName: 'Someone' });

describe('CommentBodySchema', () => {
  it('trims and accepts 1–10,000 characters', () => {
    expect(CommentBodySchema.parse('  looks good  ')).toBe('looks good');
    expect(CommentBodySchema.safeParse('x'.repeat(10_000)).success).toBe(true);
  });

  it.each(['', '   \n\t', 'x'.repeat(10_001), 'a\0b'])('rejects %j', (body) => {
    expect(CommentBodySchema.safeParse(body).success).toBe(false);
  });
});

describe('CreateThreadRequestSchema', () => {
  it('without an anchor: a review-level thread', () => {
    expect(CreateThreadRequestSchema.parse({ body: 'Nice' })).toEqual({ body: 'Nice' });
  });

  it('with an anchor', () => {
    const anchor = { fileId: FILE, side: 'new', line: 12 };
    expect(CreateThreadRequestSchema.parse({ body: 'Why?', anchor })).toEqual({
      body: 'Why?',
      anchor,
    });
  });

  it.each([
    { fileId: 'nope', side: 'new', line: 1 },
    { fileId: FILE, side: 'left', line: 1 },
    { fileId: FILE, side: 'old', line: 0 },
    { fileId: FILE, side: 'old', line: 1.5 },
    { fileId: FILE, side: 'old', line: 2_147_483_648 },
    { fileId: FILE, side: 'old', line: '3' },
    { fileId: FILE, side: 'old' },
  ])('rejects the anchor %j', (anchor) => {
    expect(CreateThreadRequestSchema.safeParse({ body: 'x', anchor }).success).toBe(false);
  });
});

describe('SetThreadStatusRequestSchema', () => {
  it('accepts only open and resolved', () => {
    expect(SetThreadStatusRequestSchema.safeParse({ status: 'resolved' }).success).toBe(true);
    expect(SetThreadStatusRequestSchema.safeParse({ status: 'closed' }).success).toBe(false);
  });
});

describe('ThreadSchema', () => {
  it('parses a thread with a deleted comment and a deleted author', () => {
    const thread = {
      id: OTHER,
      reviewId: ME,
      anchor: { fileId: FILE, side: 'old', line: 3, lineContent: 'const a = 1;' },
      status: 'open',
      resolvedBy: null,
      resolvedAt: null,
      createdBy: null,
      createdAt: '2026-11-04T10:00:00.000Z',
      comments: [
        {
          id: FILE,
          threadId: OTHER,
          author: null,
          body: '',
          createdAt: '2026-11-04T10:00:00.000Z',
          edited: false,
          deleted: true,
        },
      ],
    };
    expect(ThreadSchema.parse(thread)).toEqual(thread);
  });
});

describe('canComment', () => {
  it.each([
    ['owner', true],
    ['admin', true],
    ['member', true],
    ['viewer', false],
  ] as const)('%s → %s', (role, allowed) => {
    expect(canComment(role)).toBe(allowed);
  });
});

describe('canEditComment', () => {
  it('only the author, while the comment is not deleted', () => {
    expect(canEditComment(ME, { author: user(ME), deleted: false })).toBe(true);
    expect(canEditComment(ME, { author: user(ME), deleted: true })).toBe(false);
    expect(canEditComment(ME, { author: user(OTHER), deleted: false })).toBe(false);
    expect(canEditComment(ME, { author: null, deleted: false })).toBe(false);
  });
});

describe('canDeleteComment', () => {
  // [role, own comment?, allowed]
  it.each([
    ['owner', false, true],
    ['admin', false, true],
    ['member', false, false],
    ['viewer', false, false],
    ['owner', true, true],
    ['admin', true, true],
    ['member', true, true],
    // Demoted to viewer: no longer allowed to change anything, even their own words.
    ['viewer', true, false],
  ] as const)('%s, own comment: %s → %s', (role, own, allowed) => {
    const comment = { author: user(own ? ME : OTHER), deleted: false };
    expect(canDeleteComment(role, ME, comment)).toBe(allowed);
  });

  it('nobody deletes an already deleted comment', () => {
    for (const role of ROLES) {
      expect(canDeleteComment(role, ME, { author: user(ME), deleted: true })).toBe(false);
    }
  });

  it('admins can delete a comment whose author was deleted', () => {
    expect(canDeleteComment('admin', ME, { author: null, deleted: false })).toBe(true);
    expect(canDeleteComment('member', ME, { author: null, deleted: false })).toBe(false);
  });
});

describe('canResolveThread', () => {
  // [role, started the thread, wrote the review, allowed]
  it.each([
    ['owner', false, false, true],
    ['admin', false, false, true],
    ['member', false, false, false],
    ['member', true, false, true],
    ['member', false, true, true],
    ['viewer', true, true, false],
    ['viewer', false, false, false],
  ] as const)(
    '%s, thread creator: %s, review author: %s → %s',
    (role, creator, author, allowed) => {
      const thread = { createdBy: user(creator ? ME : OTHER) };
      expect(canResolveThread(role, ME, thread, author ? ME : OTHER)).toBe(allowed);
    },
  );

  it('deleted creator and review author: only admins and owners', () => {
    expect(canResolveThread('member', ME, { createdBy: null }, null)).toBe(false);
    expect(canResolveThread('admin', ME, { createdBy: null }, null)).toBe(true);
  });
});
