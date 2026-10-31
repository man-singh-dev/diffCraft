import { randomUUID } from 'node:crypto';
import { DiffParseError, parsePatch, type CreateReviewRequest } from '@diffcraft/shared';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';
import { reviewFiles, reviews, users, workspaces } from '../../db/schema/index.js';
import { describeWithDb, testDatabaseUrl } from '../../test/db.js';
import { createUserWithSession, failInsertInTransaction } from '../../test/fixtures.js';
import { createWorkspace } from '../workspaces/service.js';
import { createReview, getReview, getReviewFileHunks, listReviewFiles } from './service.js';

// Three files in patch order: modified (two hunks), added, deleted.
const PATCH = `diff --git a/src/app.ts b/src/app.ts
index 1111111..2222222 100644
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
diff --git a/README.md b/README.md
new file mode 100644
index 0000000..3333333
--- /dev/null
+++ b/README.md
@@ -0,0 +1,2 @@
+# App
+Hello.
diff --git a/old.txt b/old.txt
deleted file mode 100644
index 4444444..0000000
--- a/old.txt
+++ /dev/null
@@ -1 +0,0 @@
-bye
`;

const input = (overrides: Partial<CreateReviewRequest> = {}): CreateReviewRequest => ({
  title: 'Change the port',
  description: null,
  patch: PATCH,
  ...overrides,
});

describeWithDb('reviews service and tables', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp(loadConfig({ LOG_LEVEL: 'silent', DATABASE_URL: testDatabaseUrl }));
  });

  afterAll(async () => {
    await app.close();
  });

  async function setup() {
    const author = await createUserWithSession(app.db);
    const workspace = await createWorkspace(app.db, author.id, { name: `Team ${randomUUID()}` });
    return { authorId: author.id, workspaceId: workspace.id };
  }

  async function counter(workspaceId: string) {
    const [row] = await app.db
      .select({ last: workspaces.lastReviewNumber, updatedAt: workspaces.updatedAt })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId));
    return row;
  }

  const reviewsIn = (workspaceId: string) =>
    app.db.select().from(reviews).where(eq(reviews.workspaceId, workspaceId));

  it('stores the review with totals, files in patch order and hunks that round-trip', async () => {
    const { authorId, workspaceId } = await setup();

    const review = await createReview(app.db, {
      workspaceId,
      authorId,
      input: input({ description: 'Ops asked for 8080.' }),
    });

    expect(review).toMatchObject({
      workspaceId,
      number: 1,
      title: 'Change the port',
      description: 'Ops asked for 8080.',
      status: 'open',
      author: { id: authorId, displayName: 'Test' },
      filesChanged: 3,
      additions: 4,
      deletions: 2,
    });
    await expect(getReview(app.db, workspaceId, review.id)).resolves.toEqual(review);

    const [stored] = await reviewsIn(workspaceId);
    expect(stored?.patch).toBe(PATCH);

    const files = await listReviewFiles(app.db, review.id);
    expect(
      files.map((f) => [f.position, f.oldPath, f.newPath, f.changeType, f.additions, f.deletions]),
    ).toEqual([
      [0, 'src/app.ts', 'src/app.ts', 'modified', 2, 1],
      [1, null, 'README.md', 'added', 2, 0],
      [2, 'old.txt', null, 'deleted', 0, 1],
    ]);
    expect(files[0]).not.toHaveProperty('hunks');

    const parsed = parsePatch(PATCH);
    for (const [index, file] of files.entries()) {
      await expect(getReviewFileHunks(app.db, review.id, file.id)).resolves.toEqual(
        parsed.files[index]!.hunks,
      );
    }
  });

  it('numbers reviews 1, 2, 3 per workspace, starting again at 1 in another one', async () => {
    const first = await setup();
    const second = await setup();
    const create = (ws: { authorId: string; workspaceId: string }) =>
      createReview(app.db, { ...ws, input: input() });

    const numbers = [];
    for (let i = 0; i < 3; i++) numbers.push((await create(first)).number);
    numbers.push((await create(second)).number);

    expect(numbers).toEqual([1, 2, 3, 1]);
    expect((await counter(first.workspaceId))?.last).toBe(3);
  });

  it('gives 10 parallel creates the numbers 1 to 10 without errors', async () => {
    const ws = await setup();

    const created = await Promise.all(
      Array.from({ length: 10 }, () => createReview(app.db, { ...ws, input: input() })),
    );

    expect(created.map((r) => r.number).sort((a, b) => a - b)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    ]);
    expect((await counter(ws.workspaceId))?.last).toBe(10);
  });

  it('does not touch the workspace updated_at when handing out a number', async () => {
    const ws = await setup();
    const before = await counter(ws.workspaceId);

    await createReview(app.db, { ...ws, input: input() });

    expect((await counter(ws.workspaceId))?.updatedAt).toEqual(before?.updatedAt);
  });

  it('rolls back the review and the counter when inserting the files fails', async () => {
    const ws = await setup();
    await createReview(app.db, { ...ws, input: input() });

    // The proxy makes tx.insert(reviewFiles) throw. By then the counter UPDATE and the review
    // INSERT have really run in the same transaction, so this proves they are rolled back. A
    // patch can't trigger a real constraint error here: everything parsePatch returns is valid.
    const failing = failInsertInTransaction(app.db, reviewFiles, 'forced review_files failure');
    await expect(createReview(failing, { ...ws, input: input() })).rejects.toThrow(
      'forced review_files failure',
    );

    expect(await reviewsIn(ws.workspaceId)).toHaveLength(1);
    expect((await counter(ws.workspaceId))?.last).toBe(1);
  });

  it('throws the DiffParseError for an invalid patch and writes nothing', async () => {
    const ws = await setup();
    const badCounts = '--- a/x\n+++ b/x\n@@ -1,3 +1,3 @@\n a\n';

    for (const patch of ['not a diff', badCounts]) {
      await expect(createReview(app.db, { ...ws, input: input({ patch }) })).rejects.toBeInstanceOf(
        DiffParseError,
      );
    }

    expect(await reviewsIn(ws.workspaceId)).toEqual([]);
    expect((await counter(ws.workspaceId))?.last).toBe(0);
  });

  it('throws workspace_not_found for a workspace that does not exist', async () => {
    const { authorId } = await setup();
    await expect(
      createReview(app.db, { workspaceId: randomUUID(), authorId, input: input() }),
    ).rejects.toMatchObject({ statusCode: 404, code: 'workspace_not_found' });
  });

  it('finds a review only through its own workspace', async () => {
    const ws = await setup();
    const other = await setup();
    const review = await createReview(app.db, { ...ws, input: input() });

    await expect(getReview(app.db, other.workspaceId, review.id)).resolves.toBeNull();
    await expect(getReview(app.db, ws.workspaceId, randomUUID())).resolves.toBeNull();
  });

  it('finds hunks only for a file of the given review', async () => {
    const ws = await setup();
    const review = await createReview(app.db, { ...ws, input: input() });
    const otherReview = await createReview(app.db, { ...ws, input: input() });
    const [file] = await listReviewFiles(app.db, review.id);

    await expect(getReviewFileHunks(app.db, otherReview.id, file!.id)).resolves.toBeNull();
    await expect(getReviewFileHunks(app.db, review.id, randomUUID())).resolves.toBeNull();
  });

  it('deletes reviews and their files with the workspace', async () => {
    const ws = await setup();
    const review = await createReview(app.db, { ...ws, input: input() });

    await app.db.delete(workspaces).where(eq(workspaces.id, ws.workspaceId));

    expect(await reviewsIn(ws.workspaceId)).toEqual([]);
    expect(
      await app.db.select().from(reviewFiles).where(eq(reviewFiles.reviewId, review.id)),
    ).toEqual([]);
  });

  it('keeps the review with author null when the author is deleted', async () => {
    const ws = await setup();
    const review = await createReview(app.db, { ...ws, input: input() });

    await app.db.delete(users).where(eq(users.id, ws.authorId));

    const after = await getReview(app.db, ws.workspaceId, review.id);
    expect(after).toEqual({ ...review, author: null });
    await expect(listReviewFiles(app.db, review.id)).resolves.toHaveLength(3);
  });
});
