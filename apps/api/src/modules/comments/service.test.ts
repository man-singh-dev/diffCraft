import { randomUUID } from 'node:crypto';
import type { Thread } from '@diffcraft/shared';
import { eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';
import { comments, commentThreads, users } from '../../db/schema/index.js';
import { describeWithDb, testDatabaseUrl } from '../../test/db.js';
import { createUserWithSession, failInsertInTransaction } from '../../test/fixtures.js';
import { createReview, deleteReview, listReviewFiles } from '../reviews/service.js';
import { createWorkspace } from '../workspaces/service.js';
import { CommentAnchorInvalidError } from './errors.js';
import {
  addReply,
  createThread,
  deleteComment,
  editComment,
  getComment,
  getThread,
  listThreads,
  setThreadStatus,
} from './service.js';

const PATCH = `diff --git a/src/app.ts b/src/app.ts
--- a/src/app.ts
+++ b/src/app.ts
@@ -1,3 +1,3 @@
 import x from 'x';
-const port = 3000;
+const port = 8080;
 start(port);
@@ -10,2 +10,3 @@ function start()
 log('ready');
+log('listening');
 return app;
diff --git a/logo.png b/logo.png
index d9d6533..a6a3e7f 100644
Binary files a/logo.png and b/logo.png differ
diff --git a/old-name.txt b/new-name.txt
similarity index 100%
rename from old-name.txt
rename to new-name.txt
`;

describeWithDb('comments service and tables', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp(
      loadConfig({
        LOG_LEVEL: 'silent',
        RATE_LIMIT_ENABLED: 'false',
        DATABASE_URL: testDatabaseUrl,
      }),
    );
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function setup() {
    const author = await createUserWithSession(app.db);
    const workspace = await createWorkspace(app.db, author.id, { name: `Team ${randomUUID()}` });
    const review = await createReview(app.db, {
      workspaceId: workspace.id,
      authorId: author.id,
      input: { title: 'Port', description: null, patch: PATCH },
    });
    const [code, binary, rename] = await listReviewFiles(app.db, workspace.id, review.id);
    const ctx = { workspaceId: workspace.id, reviewId: review.id };
    return { ...ctx, authorId: author.id, code: code!, binary: binary!, rename: rename! };
  }

  type Setup = Awaited<ReturnType<typeof setup>>;

  const lineThread = (s: Setup, side: 'old' | 'new', line: number, body = 'Why?') =>
    createThread(app.db, {
      workspaceId: s.workspaceId,
      reviewId: s.reviewId,
      authorId: s.authorId,
      input: { body, anchor: { fileId: s.code.id, side, line } },
    });

  const reviewThread = (s: Setup, body = 'Overall fine.') =>
    createThread(app.db, {
      workspaceId: s.workspaceId,
      reviewId: s.reviewId,
      authorId: s.authorId,
      input: { body },
    });

  it('creates a review-level thread with its first comment', async () => {
    const s = await setup();
    const thread = await reviewThread(s);

    expect(thread).toMatchObject({
      reviewId: s.reviewId,
      anchor: null,
      status: 'open',
      resolvedBy: null,
      resolvedAt: null,
      createdBy: { id: s.authorId, displayName: 'Test' },
    });
    expect(thread.comments).toEqual([
      {
        id: expect.any(String),
        threadId: thread.id,
        author: { id: s.authorId, displayName: 'Test' },
        body: 'Overall fine.',
        createdAt: expect.any(String),
        edited: false,
        deleted: false,
      },
    ]);
  });

  it.each([
    ['old', 2, 'const port = 3000;'],
    ['new', 2, 'const port = 8080;'],
    ['old', 1, "import x from 'x';"],
    ['new', 11, "log('listening');"],
    ['new', 12, 'return app;'],
    ['old', 11, 'return app;'],
  ] as const)(
    'anchors a thread on %s line %d and stores its content',
    async (side, line, content) => {
      const s = await setup();
      const thread = await lineThread(s, side, line);
      expect(thread.anchor).toEqual({ fileId: s.code.id, side, line, lineContent: content });
    },
  );

  it.each([
    ['a line between the hunks', 'old', 7],
    ['a line outside the hunks', 'new', 5],
    ['a new-side-only line number on the old side', 'old', 12],
    ['a line past the last hunk', 'new', 13],
  ] as const)('rejects %s (%s %d)', async (_name, side, line) => {
    const s = await setup();
    await expect(lineThread(s, side, line)).rejects.toBeInstanceOf(CommentAnchorInvalidError);
    expect(await listThreads(app.db, s.workspaceId, s.reviewId)).toEqual([]);
  });

  it('rejects binary files and files with no hunks', async () => {
    const s = await setup();
    for (const file of [s.binary, s.rename]) {
      await expect(
        createThread(app.db, {
          workspaceId: s.workspaceId,
          reviewId: s.reviewId,
          authorId: s.authorId,
          input: { body: 'x', anchor: { fileId: file.id, side: 'new', line: 1 } },
        }),
      ).rejects.toMatchObject({ code: 'invalid_anchor', statusCode: 422 });
    }
  });

  it('a file from another review is not found', async () => {
    const s = await setup();
    const other = await setup();
    await expect(
      createThread(app.db, {
        workspaceId: s.workspaceId,
        reviewId: s.reviewId,
        authorId: s.authorId,
        input: { body: 'x', anchor: { fileId: other.code.id, side: 'new', line: 2 } },
      }),
    ).rejects.toMatchObject({ code: 'review_file_not_found', statusCode: 404 });
  });

  it('a review in another workspace is not found', async () => {
    const s = await setup();
    const other = await setup();
    await expect(
      createThread(app.db, {
        workspaceId: other.workspaceId,
        reviewId: s.reviewId,
        authorId: s.authorId,
        input: { body: 'x' },
      }),
    ).rejects.toMatchObject({ code: 'review_not_found' });
    await expect(
      createThread(app.db, {
        workspaceId: other.workspaceId,
        reviewId: s.reviewId,
        authorId: s.authorId,
        input: { body: 'x', anchor: { fileId: s.code.id, side: 'new', line: 2 } },
      }),
    ).rejects.toMatchObject({ code: 'review_file_not_found' });
  });

  it('the thread and its first comment are created atomically', async () => {
    const s = await setup();
    const failing = failInsertInTransaction(app.db, comments, 'comment insert failed');
    await expect(
      createThread(failing, {
        workspaceId: s.workspaceId,
        reviewId: s.reviewId,
        authorId: s.authorId,
        input: { body: 'x' },
      }),
    ).rejects.toThrow('comment insert failed');

    const left = await app.db
      .select()
      .from(commentThreads)
      .where(eq(commentThreads.reviewId, s.reviewId));
    expect(left).toEqual([]);
  });

  it('lists threads in order: review-level first, then file, side and line, oldest first', async () => {
    const s = await setup();
    const t1 = await lineThread(s, 'new', 11, 'new 11');
    const t2 = await reviewThread(s, 'review A');
    const t3 = await lineThread(s, 'old', 2, 'old 2');
    const t4 = await lineThread(s, 'new', 2, 'new 2');
    const t5 = await reviewThread(s, 'review B');
    const t6 = await lineThread(s, 'old', 1, 'old 1');
    await addReply(app.db, { ...s, threadId: t3.id, authorId: s.authorId, body: 'reply to old 2' });

    const threads = await listThreads(app.db, s.workspaceId, s.reviewId);
    expect(threads.map((t) => t.id)).toEqual([t2.id, t5.id, t6.id, t3.id, t4.id, t1.id]);
    expect(threads.map((t) => t.comments.map((c) => c.body))).toEqual([
      ['review A'],
      ['review B'],
      ['old 1'],
      ['old 2', 'reply to old 2'],
      ['new 2'],
      ['new 11'],
    ]);
  });

  it('lists threads with a fixed number of queries', async () => {
    const pool = app.db.$client;
    async function queriesFor(threadCount: number) {
      const s = await setup();
      for (let i = 0; i < threadCount; i++) {
        const thread = await reviewThread(s, `thread ${i}`);
        await addReply(app.db, { ...s, threadId: thread.id, authorId: s.authorId, body: 'reply' });
      }
      const spy = vi.spyOn(pool, 'query');
      const threads = await listThreads(app.db, s.workspaceId, s.reviewId);
      const count = spy.mock.calls.length;
      spy.mockRestore();
      expect(threads).toHaveLength(threadCount);
      expect(threads.every((t) => t.comments.length === 2)).toBe(true);
      return count;
    }

    expect(await queriesFor(1)).toBe(2);
    expect(await queriesFor(20)).toBe(2);
  });

  it('no threads: one query and an empty list', async () => {
    const s = await setup();
    expect(await listThreads(app.db, s.workspaceId, s.reviewId)).toEqual([]);
  });

  it('threads and comments are scoped to the review and workspace', async () => {
    const s = await setup();
    const other = await setup();
    const thread = await reviewThread(s);
    const commentId = thread.comments[0]!.id;
    const wrongScopes = [
      { workspaceId: other.workspaceId, reviewId: s.reviewId },
      { workspaceId: s.workspaceId, reviewId: other.reviewId },
      { workspaceId: other.workspaceId, reviewId: other.reviewId },
    ];
    for (const scope of wrongScopes) {
      expect(await getThread(app.db, scope.workspaceId, scope.reviewId, thread.id)).toBeNull();
      expect(await getComment(app.db, scope.workspaceId, scope.reviewId, commentId)).toBeNull();
      expect(await listThreads(app.db, scope.workspaceId, scope.reviewId)).toEqual([]);
      expect(
        await addReply(app.db, { ...scope, threadId: thread.id, authorId: s.authorId, body: 'x' }),
      ).toBeNull();
      expect(
        await editComment(app.db, scope.workspaceId, scope.reviewId, commentId, 'x'),
      ).toBeNull();
      expect(await deleteComment(app.db, scope.workspaceId, scope.reviewId, commentId)).toBeNull();
      expect(
        await setThreadStatus(app.db, {
          ...scope,
          threadId: thread.id,
          userId: s.authorId,
          status: 'resolved',
        }),
      ).toBeNull();
    }
    expect(await getThread(app.db, s.workspaceId, s.reviewId, thread.id)).toEqual(thread);
  });

  it('replies are added in order', async () => {
    const s = await setup();
    const replier = await createUserWithSession(app.db);
    const thread = await reviewThread(s, 'first');
    const reply = await addReply(app.db, {
      ...s,
      threadId: thread.id,
      authorId: replier.id,
      body: 'second',
    });
    expect(reply).toMatchObject({
      threadId: thread.id,
      author: { id: replier.id },
      body: 'second',
      edited: false,
      deleted: false,
    });
    const updated = await getThread(app.db, s.workspaceId, s.reviewId, thread.id);
    expect(updated!.comments.map((c) => c.body)).toEqual(['first', 'second']);
  });

  it('editing a comment changes its body and marks it edited', async () => {
    const s = await setup();
    const thread = await reviewThread(s, 'typo');
    const id = thread.comments[0]!.id;
    const edited = await editComment(app.db, s.workspaceId, s.reviewId, id, 'fixed');
    expect(edited).toMatchObject({ id, body: 'fixed', edited: true, deleted: false });
    expect(edited!.createdAt).toBe(thread.comments[0]!.createdAt);
  });

  it('deleting a comment empties its body and keeps the row', async () => {
    const s = await setup();
    const thread = await reviewThread(s, 'first');
    await addReply(app.db, { ...s, threadId: thread.id, authorId: s.authorId, body: 'second' });
    const id = thread.comments[0]!.id;

    const deleted = await deleteComment(app.db, s.workspaceId, s.reviewId, id);
    expect(deleted).toMatchObject({ id, body: '', deleted: true, edited: false });

    const [row] = await app.db.select().from(comments).where(eq(comments.id, id));
    expect(row).toMatchObject({ body: '', deletedAt: expect.any(Date) });

    const [listed] = await listThreads(app.db, s.workspaceId, s.reviewId);
    expect(listed!.comments.map((c) => [c.body, c.deleted])).toEqual([
      ['', true],
      ['second', false],
    ]);

    expect(await editComment(app.db, s.workspaceId, s.reviewId, id, 'back')).toBeNull();
    expect(await deleteComment(app.db, s.workspaceId, s.reviewId, id)).toBeNull();
  });

  it('setThreadStatus is idempotent, and reopening clears the resolved fields', async () => {
    const s = await setup();
    const other = await createUserWithSession(app.db);
    const thread = await lineThread(s, 'new', 2);
    const set = (userId: string, status: Thread['status']) =>
      setThreadStatus(app.db, { ...s, threadId: thread.id, userId, status });

    const resolved = await set(s.authorId, 'resolved');
    expect(resolved).toMatchObject({
      status: 'resolved',
      resolvedBy: { id: s.authorId },
      resolvedAt: expect.any(String),
    });

    const again = await set(other.id, 'resolved');
    expect(again!.resolvedBy).toEqual(resolved!.resolvedBy);
    expect(again!.resolvedAt).toBe(resolved!.resolvedAt);

    const reopened = await set(other.id, 'open');
    expect(reopened).toMatchObject({ status: 'open', resolvedBy: null, resolvedAt: null });
    expect(await set(other.id, 'open')).toEqual(reopened);
  });

  it('deleting the review deletes its threads and comments', async () => {
    const s = await setup();
    const thread = await lineThread(s, 'new', 2);
    await reviewThread(s);
    expect(await deleteReview(app.db, s.workspaceId, s.reviewId)).toBe(true);

    expect(
      await app.db.select().from(commentThreads).where(eq(commentThreads.reviewId, s.reviewId)),
    ).toEqual([]);
    expect(await app.db.select().from(comments).where(eq(comments.threadId, thread.id))).toEqual(
      [],
    );
  });

  it('deleting a user keeps their threads and comments, with no author', async () => {
    const s = await setup();
    const replier = await createUserWithSession(app.db);
    const thread = await reviewThread(s);
    await addReply(app.db, { ...s, threadId: thread.id, authorId: replier.id, body: 'bye' });
    await setThreadStatus(app.db, {
      ...s,
      threadId: thread.id,
      userId: replier.id,
      status: 'resolved',
    });

    await app.db.delete(users).where(eq(users.id, replier.id));

    const after = await getThread(app.db, s.workspaceId, s.reviewId, thread.id);
    expect(after!.comments.map((c) => c.author?.id ?? null)).toEqual([s.authorId, null]);
    expect(after).toMatchObject({
      status: 'resolved',
      resolvedBy: null,
      resolvedAt: expect.any(String),
    });
  });

  it('CHECK constraints reject a half anchor and inconsistent resolution', async () => {
    const s = await setup();
    const base = { reviewId: s.reviewId, createdBy: s.authorId };
    const rejects = (values: Partial<typeof commentThreads.$inferInsert>) =>
      expect(app.db.insert(commentThreads).values({ ...base, ...values })).rejects.toMatchObject({
        cause: { code: '23514' }, // check_violation
      });

    await rejects({ fileId: s.code.id });
    await rejects({ fileId: s.code.id, side: 'new', line: 2 });
    await rejects({ side: 'new', line: 2, lineContent: 'x' });
    await rejects({ fileId: s.code.id, side: 'new', line: 0, lineContent: 'x' });
    await rejects({ status: 'resolved' });
    await rejects({ status: 'open', resolvedAt: new Date() });

    const ok = await app.db
      .insert(commentThreads)
      .values([
        base,
        { ...base, fileId: s.code.id, side: 'new', line: 2, lineContent: 'x' },
        { ...base, status: 'resolved', resolvedAt: new Date() },
      ])
      .returning({ id: commentThreads.id });
    expect(ok).toHaveLength(3);
    await app.db.delete(commentThreads).where(
      inArray(
        commentThreads.id,
        ok.map((r) => r.id),
      ),
    );
  });
});
