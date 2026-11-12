import { randomUUID } from 'node:crypto';
import {
  CommentSchema,
  ErrorResponseSchema,
  parsePatch,
  ReviewFileSchema,
  ReviewSchema,
  ThreadSchema,
  WorkspaceSchema,
  type Review,
  type Thread,
  type Workspace,
  type WorkspaceRole,
} from '@diffcraft/shared';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';
import { workspaceMembers } from '../../db/schema/index.js';
import { describeWithDb, testDatabaseUrl } from '../../test/db.js';
import { addMember, createUserWithSession, type TestUser } from '../../test/fixtures.js';

const BASE = '/api/v1/workspaces';

const PATCH = `diff --git a/src/app.ts b/src/app.ts
--- a/src/app.ts
+++ b/src/app.ts
@@ -1,2 +1,2 @@
 const a = 1;
-const b = 2;
+const b = 3;
diff --git a/logo.png b/logo.png
index d9d6533..a6a3e7f 100644
Binary files a/logo.png and b/logo.png differ
`;

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';
type Endpoint = 'list' | 'create' | 'reply' | 'edit' | 'delete' | 'resolve';
type Caller = 'logged out' | 'non-member' | WorkspaceRole;

// Review by the owner, thread and comment by another member: edit is never the caller's own words, delete needs an admin, resolve needs the creator, review author or an admin.
const MATRIX: Record<Endpoint, Record<Caller, number>> = {
  list: { 'logged out': 401, 'non-member': 404, viewer: 200, member: 200, admin: 200, owner: 200 },
  create: {
    'logged out': 401,
    'non-member': 404,
    viewer: 403,
    member: 201,
    admin: 201,
    owner: 201,
  },
  reply: { 'logged out': 401, 'non-member': 404, viewer: 403, member: 201, admin: 201, owner: 201 },
  edit: { 'logged out': 401, 'non-member': 404, viewer: 403, member: 403, admin: 403, owner: 403 },
  delete: {
    'logged out': 401,
    'non-member': 404,
    viewer: 403,
    member: 403,
    admin: 200,
    owner: 200,
  },
  resolve: {
    'logged out': 401,
    'non-member': 404,
    viewer: 403,
    member: 403,
    admin: 200,
    owner: 200,
  },
};

describeWithDb('comment routes', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp(
      loadConfig({
        LOG_LEVEL: 'silent',
        RATE_LIMIT_ENABLED: 'false',
        NODE_ENV: 'test',
        DATABASE_URL: testDatabaseUrl,
      }),
    );
  });

  afterAll(async () => {
    await app.close();
  });

  const call = (method: Method, url: string, user?: TestUser, payload?: object) =>
    app.inject({
      method,
      url,
      ...(user && { cookies: user.cookies }),
      ...(payload !== undefined && { payload }),
    });

  const errorOf = (res: LightMyRequestResponse) => ErrorResponseSchema.parse(res.json()).error;

  async function createWorkspace(owner: TestUser): Promise<Workspace> {
    const res = await call('POST', BASE, owner, { name: `Team ${randomUUID()}` });
    expect(res.statusCode).toBe(201);
    return WorkspaceSchema.parse(res.json());
  }

  async function memberWithRole(workspaceId: string, role: WorkspaceRole): Promise<TestUser> {
    const user = await createUserWithSession(app.db);
    await addMember(app.db, workspaceId, user.id, role);
    return user;
  }

  async function createReview(workspaceId: string, user: TestUser): Promise<Review> {
    const res = await call('POST', `${BASE}/${workspaceId}/reviews`, user, {
      title: 'Fix b',
      patch: PATCH,
    });
    expect(res.statusCode).toBe(201);
    return ReviewSchema.parse(res.json());
  }

  const threadsUrl = (workspaceId: string, review: Review, rest = '') =>
    `${BASE}/${workspaceId}/reviews/${review.number}/threads${rest}`;

  async function startThread(
    workspaceId: string,
    review: Review,
    user: TestUser,
    body: object = { body: 'Why 3?' },
  ): Promise<Thread> {
    const res = await call('POST', threadsUrl(workspaceId, review), user, body);
    expect(res.statusCode).toBe(201);
    return ThreadSchema.parse(res.json());
  }

  async function files(workspaceId: string, review: Review, user: TestUser) {
    const res = await call('GET', `${BASE}/${workspaceId}/reviews/${review.number}/files`, user);
    return ReviewFileSchema.array().parse(res.json());
  }

  async function setup() {
    const owner = await createUserWithSession(app.db);
    const workspace = await createWorkspace(owner);
    const review = await createReview(workspace.id, owner);
    const author = await memberWithRole(workspace.id, 'member');
    const thread = await startThread(workspace.id, review, author);
    const [code, binary] = await files(workspace.id, review, owner);
    const url = (rest = '') => threadsUrl(workspace.id, review, rest);
    const commentUrl = (t: Thread = thread, commentId = t.comments[0]!.id) =>
      url(`/${t.id}/comments/${commentId}`);
    return {
      owner,
      workspace,
      review,
      author,
      thread,
      code: code!,
      binary: binary!,
      url,
      commentUrl,
    };
  }

  describe('authorization matrix', () => {
    const callers: Caller[] = ['logged out', 'non-member', 'viewer', 'member', 'admin', 'owner'];
    const cases = (Object.keys(MATRIX) as Endpoint[]).flatMap((endpoint) =>
      callers.map((caller) => ({ endpoint, caller, expected: MATRIX[endpoint][caller] })),
    );

    it.each(cases)('$endpoint as $caller → $expected', async ({ endpoint, caller, expected }) => {
      const { owner, workspace, thread, url, commentUrl } = await setup();

      let user: TestUser | undefined;
      if (caller === 'owner') user = owner;
      else if (caller === 'non-member') user = await createUserWithSession(app.db);
      else if (caller !== 'logged out') user = await memberWithRole(workspace.id, caller);

      const res = await {
        list: () => call('GET', url(), user),
        create: () => call('POST', url(), user, { body: 'New thread' }),
        reply: () => call('POST', url(`/${thread.id}/comments`), user, { body: 'Reply' }),
        edit: () => call('PATCH', commentUrl(), user, { body: 'Edited' }),
        delete: () => call('DELETE', commentUrl(), user),
        resolve: () => call('PATCH', url(`/${thread.id}`), user, { status: 'resolved' }),
      }[endpoint]();

      expect(res.statusCode).toBe(expected);
      if (expected === 401) expect(errorOf(res).code).toBe('unauthenticated');
      if (expected === 404) expect(errorOf(res).code).toBe('workspace_not_found');
      if (expected === 403) expect(errorOf(res).code).toBe('forbidden');
    });
  });

  describe('ownership', () => {
    it('a member edits and deletes their own comment', async () => {
      const { author, commentUrl } = await setup();

      const edited = await call('PATCH', commentUrl(), author, { body: 'Why 3, not 2?' });
      expect(edited.statusCode).toBe(200);
      expect(CommentSchema.parse(edited.json())).toMatchObject({
        body: 'Why 3, not 2?',
        edited: true,
        deleted: false,
      });

      const deleted = await call('DELETE', commentUrl(), author);
      expect(deleted.statusCode).toBe(200);
      expect(CommentSchema.parse(deleted.json())).toMatchObject({ body: '', deleted: true });
    });

    it('a viewer who wrote a comment (then was demoted) may still edit but not delete it', async () => {
      const { workspace, review, url } = await setup();
      const demoted = await memberWithRole(workspace.id, 'member');
      const thread = await startThread(workspace.id, review, demoted);
      await app.db
        .update(workspaceMembers)
        .set({ role: 'viewer' })
        .where(
          and(
            eq(workspaceMembers.workspaceId, workspace.id),
            eq(workspaceMembers.userId, demoted.id),
          ),
        );
      const one = url(`/${thread.id}/comments/${thread.comments[0]!.id}`);
      expect((await call('PATCH', one, demoted, { body: 'still mine' })).statusCode).toBe(200);
      expect((await call('DELETE', one, demoted)).statusCode).toBe(403);
    });

    it('the thread creator, the review author and admins resolve; other members cannot', async () => {
      const { workspace, author, owner } = await setup();
      const reviewAuthor = await memberWithRole(workspace.id, 'member');
      const memberReview = await createReview(workspace.id, reviewAuthor);
      const thread = await startThread(workspace.id, memberReview, author);
      const other = await memberWithRole(workspace.id, 'member');
      const admin = await memberWithRole(workspace.id, 'admin');
      const resolve = (user: TestUser, status = 'resolved') =>
        call('PATCH', threadsUrl(workspace.id, memberReview, `/${thread.id}`), user, { status });

      expect((await resolve(other)).statusCode).toBe(403);
      expect((await resolve(author)).statusCode).toBe(200);
      expect((await resolve(reviewAuthor, 'open')).statusCode).toBe(200);
      expect((await resolve(admin)).statusCode).toBe(200);
      expect((await resolve(owner, 'open')).statusCode).toBe(200);
    });
  });

  describe('nesting and isolation', () => {
    it('a comment id from another thread of the same review is not found', async () => {
      const { workspace, review, author, thread, url } = await setup();
      const other = await startThread(workspace.id, review, author, { body: 'Other thread' });
      const res = await call(
        'PATCH',
        url(`/${thread.id}/comments/${other.comments[0]!.id}`),
        author,
        { body: 'x' },
      );
      expect(res.statusCode).toBe(404);
      expect(errorOf(res).code).toBe('comment_not_found');
      const del = await call(
        'DELETE',
        url(`/${thread.id}/comments/${other.comments[0]!.id}`),
        author,
      );
      expect(errorOf(del).code).toBe('comment_not_found');
    });

    it('a thread from another review is not found', async () => {
      const { workspace, owner, author, url } = await setup();
      const otherReview = await createReview(workspace.id, owner);
      const otherThread = await startThread(workspace.id, otherReview, author);

      for (const res of [
        await call('PATCH', url(`/${otherThread.id}`), owner, { status: 'resolved' }),
        await call('POST', url(`/${otherThread.id}/comments`), owner, { body: 'x' }),
        await call(
          'DELETE',
          url(`/${otherThread.id}/comments/${otherThread.comments[0]!.id}`),
          owner,
        ),
      ]) {
        expect(res.statusCode).toBe(404);
        expect(errorOf(res).code).toBe('thread_not_found');
      }
    });

    it('a review of another workspace is not found, even for a member of both', async () => {
      const { workspace, review, thread, owner } = await setup();
      const second = await createWorkspace(owner);
      await createReview(second.id, owner);

      // Same review number, other workspace: a different review, so the thread isn't in it.
      const res = await call('PATCH', threadsUrl(second.id, review, `/${thread.id}`), owner, {
        status: 'resolved',
      });
      expect(res.statusCode).toBe(404);
      expect(errorOf(res).code).toBe('thread_not_found');

      const extra = await createReview(workspace.id, owner);
      const missing = await call('GET', threadsUrl(second.id, extra), owner);
      expect(missing.statusCode).toBe(404);
      expect(errorOf(missing).code).toBe('review_not_found');
    });

    it.each([
      ['a malformed thread id', '/not-a-uuid', 'thread_not_found'],
      ['an unknown thread id', `/${randomUUID()}`, 'thread_not_found'],
    ])('%s → 404', async (_name, rest, code) => {
      const { owner, url } = await setup();
      const res = await call('PATCH', url(rest), owner, { status: 'resolved' });
      expect(res.statusCode).toBe(404);
      expect(errorOf(res).code).toBe(code);
    });

    it('a malformed comment id → 404 comment_not_found', async () => {
      const { author, thread, url } = await setup();
      const res = await call('PATCH', url(`/${thread.id}/comments/nope`), author, { body: 'x' });
      expect(errorOf(res).code).toBe('comment_not_found');
    });

    it('checks the review before the thread, and permissions before the body', async () => {
      const { owner, workspace, thread, url, commentUrl } = await setup();
      const missingReview = await call(
        'PATCH',
        `${BASE}/${workspace.id}/reviews/999/threads/${thread.id}`,
        owner,
        { status: 'resolved' },
      );
      expect(errorOf(missingReview).code).toBe('review_not_found');

      const other = await memberWithRole(workspace.id, 'member');
      expect((await call('PATCH', commentUrl(), other, { body: '' })).statusCode).toBe(403);
      expect(
        (await call('PATCH', url(`/${thread.id}`), other, { status: 'nope' })).statusCode,
      ).toBe(403);
    });
  });

  describe('create', () => {
    it('starts a review-level thread', async () => {
      const { thread, author, review } = await setup();
      expect(thread).toMatchObject({
        reviewId: review.id,
        anchor: null,
        status: 'open',
        createdBy: { id: author.id },
        comments: [{ body: 'Why 3?', author: { id: author.id }, edited: false, deleted: false }],
      });
    });

    it('starts a line thread', async () => {
      const { workspace, review, author, code } = await setup();
      const thread = await startThread(workspace.id, review, author, {
        body: 'Magic number',
        anchor: { fileId: code.id, side: 'new', line: 2 },
      });
      expect(thread.anchor).toEqual({
        fileId: code.id,
        side: 'new',
        line: 2,
        lineContent: 'const b = 3;',
      });
    });

    it.each([
      ['a line not in the diff', 'code', 'new', 9],
      ['a deleted line on the new side', 'code', 'old', 3],
      ['a binary file', 'binary', 'new', 1],
    ] as const)('invalid anchor: %s → 422', async (_name, file, side, line) => {
      const s = await setup();
      const res = await call('POST', s.url(), s.author, {
        body: 'x',
        anchor: { fileId: s[file].id, side, line },
      });
      expect(res.statusCode).toBe(422);
      expect(errorOf(res).code).toBe('invalid_anchor');
    });

    it('a file from another review → 404 review_file_not_found', async () => {
      const { workspace, owner, author, url } = await setup();
      const otherReview = await createReview(workspace.id, owner);
      const [otherFile] = await files(workspace.id, otherReview, owner);
      const res = await call('POST', url(), author, {
        body: 'x',
        anchor: { fileId: otherFile!.id, side: 'new', line: 2 },
      });
      expect(res.statusCode).toBe(404);
      expect(errorOf(res).code).toBe('review_file_not_found');
    });

    it.each([
      ['empty', { body: '' }],
      ['whitespace only', { body: '   ' }],
      ['too long', { body: 'x'.repeat(10_001) }],
      ['with a NUL', { body: 'a\u0000b' }],
      ['missing', {}],
    ])('invalid body (%s) → 422', async (_name, payload) => {
      const { url, author, thread } = await setup();
      for (const res of [
        await call('POST', url(), author, payload),
        await call('POST', url(`/${thread.id}/comments`), author, payload),
      ]) {
        expect(res.statusCode).toBe(422);
        expect(errorOf(res).code).toBe('validation_error');
      }
    });

    it('a malformed anchor → 422', async () => {
      const { url, author } = await setup();
      const res = await call('POST', url(), author, {
        body: 'x',
        anchor: { fileId: 'nope', side: 'new', line: 1 },
      });
      expect(res.statusCode).toBe(422);
      expect(errorOf(res).code).toBe('validation_error');
    });
  });

  describe('replies, edit and delete', () => {
    it('replies are listed in order', async () => {
      const { owner, thread, url } = await setup();
      const res = await call('POST', url(`/${thread.id}/comments`), owner, { body: 'Because.' });
      expect(res.statusCode).toBe(201);
      expect(CommentSchema.parse(res.json())).toMatchObject({
        threadId: thread.id,
        author: { id: owner.id },
        body: 'Because.',
      });

      const list = ThreadSchema.array().parse((await call('GET', url(), owner)).json());
      expect(list[0]!.comments.map((c) => c.body)).toEqual(['Why 3?', 'Because.']);
    });

    it('a deleted comment stays in the list; deleting or editing it again → 404', async () => {
      const { author, owner, commentUrl, url } = await setup();
      expect((await call('DELETE', commentUrl(), author)).statusCode).toBe(200);

      const list = ThreadSchema.array().parse((await call('GET', url(), owner)).json());
      expect(list[0]!.comments).toEqual([
        expect.objectContaining({ body: '', deleted: true, edited: false }),
      ]);

      for (const res of [
        await call('DELETE', commentUrl(), author),
        await call('PATCH', commentUrl(), author, { body: 'back' }),
        await call('DELETE', commentUrl(), owner),
      ]) {
        expect(res.statusCode).toBe(404);
        expect(errorOf(res).code).toBe('comment_not_found');
      }
    });
  });

  describe('resolve', () => {
    it('resolving twice keeps the first resolvedAt; reopening clears it', async () => {
      const { author, owner, thread, url } = await setup();
      const set = (user: TestUser, status: string) =>
        call('PATCH', url(`/${thread.id}`), user, { status });

      const first = ThreadSchema.parse((await set(author, 'resolved')).json());
      expect(first).toMatchObject({ status: 'resolved', resolvedBy: { id: author.id } });

      const second = await set(owner, 'resolved');
      expect(second.statusCode).toBe(200);
      expect(ThreadSchema.parse(second.json())).toMatchObject({
        resolvedBy: { id: author.id },
        resolvedAt: first.resolvedAt,
      });

      const reopened = ThreadSchema.parse((await set(owner, 'open')).json());
      expect(reopened).toMatchObject({ status: 'open', resolvedBy: null, resolvedAt: null });
    });
  });

  it('comments are allowed on a closed review', async () => {
    const { workspace, review, owner, author, thread, url } = await setup();
    const closed = await call('PATCH', `${BASE}/${workspace.id}/reviews/${review.number}`, owner, {
      status: 'closed',
    });
    expect(closed.statusCode).toBe(200);

    expect((await call('POST', url(), author, { body: 'After closing' })).statusCode).toBe(201);
    expect(
      (await call('POST', url(`/${thread.id}/comments`), owner, { body: 'ok' })).statusCode,
    ).toBe(201);
    expect(
      (await call('PATCH', url(`/${thread.id}`), author, { status: 'resolved' })).statusCode,
    ).toBe(200);
  });

  describe('suggestion.patch', () => {
    const SUGGESTION = 'Use 4:\n```suggestion\nconst b = 4;\n```';

    async function suggestionSetup(side: 'old' | 'new' = 'new', body = SUGGESTION) {
      const base = await setup();
      const lineThread = await startThread(base.workspace.id, base.review, base.author, {
        body,
        anchor: { fileId: base.code.id, side, line: 2 },
      });
      const patchUrl = (t: Thread = lineThread, commentId = t.comments[0]!.id) =>
        `${base.commentUrl(t, commentId)}/suggestion.patch`;
      return { ...base, lineThread, patchUrl };
    }

    it('returns the patch as a download', async () => {
      const { owner, review, lineThread, patchUrl } = await suggestionSetup();
      const res = await call('GET', patchUrl(), owner);

      expect(res.statusCode).toBe(200);
      expect(res.body).toBe(
        '--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1,2 +1,2 @@\n const a = 1;\n-const b = 3;\n+const b = 4;\n',
      );
      expect(parsePatch(res.body).files[0]!.newPath).toBe('src/app.ts');
      const id = lineThread.comments[0]!.id.slice(0, 8);
      expect(res.headers).toMatchObject({
        'content-type': 'text/x-diff; charset=utf-8',
        'content-disposition': `attachment; filename="review-${review.number}-suggestion-${id}.patch"`,
        'x-content-type-options': 'nosniff',
        'cache-control': 'private, no-store',
      });
    });

    it.each([
      ['logged out', 401, 'unauthenticated'],
      ['non-member', 404, 'workspace_not_found'],
      ['viewer', 200, null],
    ] as const)('as %s → %i', async (caller, expected, code) => {
      const { workspace, patchUrl } = await suggestionSetup();
      let user: TestUser | undefined;
      if (caller === 'non-member') user = await createUserWithSession(app.db);
      if (caller === 'viewer') user = await memberWithRole(workspace.id, 'viewer');

      const res = await call('GET', patchUrl(), user);
      expect(res.statusCode).toBe(expected);
      if (code) expect(errorOf(res).code).toBe(code);
    });

    it('404 for a comment of another thread', async () => {
      const { owner, thread, lineThread, patchUrl } = await suggestionSetup();
      const res = await call('GET', patchUrl(thread, lineThread.comments[0]!.id), owner);
      expect(res.statusCode).toBe(404);
      expect(errorOf(res).code).toBe('comment_not_found');
    });

    it('422 on the old side and on a review-level thread', async () => {
      const { owner, workspace, review, author, patchUrl } = await suggestionSetup('old');
      const oldSide = await call('GET', patchUrl(), owner);
      expect(oldSide.statusCode).toBe(422);
      expect(errorOf(oldSide).code).toBe('suggestion_not_applicable');

      const reviewLevel = await startThread(workspace.id, review, author, { body: SUGGESTION });
      const res = await call('GET', patchUrl(reviewLevel), owner);
      expect(res.statusCode).toBe(422);
      expect(errorOf(res).code).toBe('suggestion_not_applicable');
    });

    it('404 when the comment has no suggestion block', async () => {
      const { owner, patchUrl } = await suggestionSetup('new', 'Just a remark');
      const res = await call('GET', patchUrl(), owner);
      expect(res.statusCode).toBe(404);
      expect(errorOf(res).code).toBe('suggestion_not_found');
    });

    it('404 for a deleted comment', async () => {
      const { author, lineThread, commentUrl, patchUrl } = await suggestionSetup();
      expect((await call('DELETE', commentUrl(lineThread), author)).statusCode).toBe(200);
      const res = await call('GET', patchUrl(), author);
      expect(res.statusCode).toBe(404);
      expect(errorOf(res).code).toBe('comment_not_found');
    });

    it('422 for a body with two suggestions', async () => {
      const { author, url } = await setup();
      const res = await call('POST', url(), author, {
        body: '```suggestion\na\n```\n```suggestion\nb\n```',
      });
      expect(res.statusCode).toBe(422);
      expect(errorOf(res)).toMatchObject({
        code: 'validation_error',
        details: [{ field: 'body', message: 'Only one suggestion per comment' }],
      });
    });
  });
});
