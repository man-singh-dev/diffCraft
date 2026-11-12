import { randomUUID } from 'node:crypto';
import {
  ErrorResponseSchema,
  type Review,
  ReviewFileDiffSchema,
  ReviewFileSchema,
  ReviewListResponseSchema,
  ReviewSchema,
  type Workspace,
  type WorkspaceRole,
  WorkspaceSchema,
} from '@diffcraft/shared';
import { eq, sql } from 'drizzle-orm';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';
import { reviewFiles, reviews } from '../../db/schema/index.js';
import { describeWithDb, testDatabaseUrl } from '../../test/db.js';
import { addMember, createUserWithSession, type TestUser } from '../../test/fixtures.js';
import { CREATE_REVIEW_BODY_LIMIT } from './routes.js';

const BASE = '/api/v1/workspaces';
// U+FEFF, built from its code point so no invisible character sits in this file.
const BOM = String.fromCharCode(0xfeff);

const PATCH = `diff --git a/src/app.ts b/src/app.ts
--- a/src/app.ts
+++ b/src/app.ts
@@ -1,2 +1,2 @@
 const a = 1;
-const b = 2;
+const b = 3;
diff --git a/src/new.ts b/src/new.ts
new file mode 100644
--- /dev/null
+++ b/src/new.ts
@@ -0,0 +1 @@
+export const x = 1;
`;

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';
type Endpoint = 'create' | 'list' | 'get' | 'update' | 'delete' | 'files' | 'diff';
type Caller = 'logged out' | 'non-member' | WorkspaceRole;

// The review is the owner's, so for update and delete a member is editing someone else's review.
const MATRIX: Record<Endpoint, Record<Caller, number>> = {
  create: {
    'logged out': 401,
    'non-member': 404,
    viewer: 403,
    member: 201,
    admin: 201,
    owner: 201,
  },
  list: { 'logged out': 401, 'non-member': 404, viewer: 200, member: 200, admin: 200, owner: 200 },
  get: { 'logged out': 401, 'non-member': 404, viewer: 200, member: 200, admin: 200, owner: 200 },
  update: {
    'logged out': 401,
    'non-member': 404,
    viewer: 403,
    member: 403,
    admin: 200,
    owner: 200,
  },
  delete: {
    'logged out': 401,
    'non-member': 404,
    viewer: 403,
    member: 403,
    admin: 204,
    owner: 204,
  },
  files: { 'logged out': 401, 'non-member': 404, viewer: 200, member: 200, admin: 200, owner: 200 },
  diff: { 'logged out': 401, 'non-member': 404, viewer: 200, member: 200, admin: 200, owner: 200 },
};

describeWithDb('review routes', () => {
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

  const call = (method: Method, url: string, user?: TestUser, payload?: object | string) =>
    app.inject({
      method,
      url,
      ...(user && { cookies: user.cookies }),
      ...(payload !== undefined && {
        payload,
        ...(typeof payload === 'string' && { headers: { 'content-type': 'application/json' } }),
      }),
    });

  const reviewsUrl = (workspaceId: string, rest = '') => `${BASE}/${workspaceId}/reviews${rest}`;

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

  async function createReview(
    workspaceId: string,
    user: TestUser,
    body: Record<string, unknown> = {},
  ): Promise<Review> {
    const res = await call('POST', reviewsUrl(workspaceId), user, {
      title: 'Fix login',
      patch: PATCH,
      ...body,
    });
    expect(res.statusCode).toBe(201);
    return ReviewSchema.parse(res.json());
  }

  async function setup() {
    const owner = await createUserWithSession(app.db);
    const workspace = await createWorkspace(owner);
    const review = await createReview(workspace.id, owner);
    return { owner, workspace, review };
  }

  async function firstFileId(workspaceId: string, review: Review, user: TestUser) {
    const res = await call('GET', reviewsUrl(workspaceId, `/${review.number}/files`), user);
    expect(res.statusCode).toBe(200);
    return ReviewFileSchema.array().parse(res.json())[0]!.id;
  }

  describe('authorization matrix', () => {
    const callers: Caller[] = ['logged out', 'non-member', 'viewer', 'member', 'admin', 'owner'];
    const endpoints = Object.keys(MATRIX) as Endpoint[];
    const cases = endpoints.flatMap((endpoint) =>
      callers.map((caller) => ({ endpoint, caller, expected: MATRIX[endpoint][caller] })),
    );

    it.each(cases)('$endpoint as $caller → $expected', async ({ endpoint, caller, expected }) => {
      const { owner, workspace, review } = await setup();
      const fileId = await firstFileId(workspace.id, review, owner);

      let user: TestUser | undefined;
      if (caller === 'owner') user = owner;
      else if (caller === 'non-member') user = await createUserWithSession(app.db);
      else if (caller !== 'logged out') user = await memberWithRole(workspace.id, caller);

      const one = reviewsUrl(workspace.id, `/${review.number}`);
      const res = await {
        create: () => call('POST', reviewsUrl(workspace.id), user, { title: 'T', patch: PATCH }),
        list: () => call('GET', reviewsUrl(workspace.id), user),
        get: () => call('GET', one, user),
        update: () => call('PATCH', one, user, { status: 'closed' }),
        delete: () => call('DELETE', one, user),
        files: () => call('GET', `${one}/files`, user),
        diff: () => call('GET', `${one}/files/${fileId}/diff`, user),
      }[endpoint]();

      expect(res.statusCode).toBe(expected);
      if (expected === 401) expect(errorOf(res).code).toBe('unauthenticated');
      if (expected === 404) expect(errorOf(res).code).toBe('workspace_not_found');
      if (expected === 403) expect(errorOf(res).code).toBe('forbidden');
    });

    it('lets a member edit and delete their own review', async () => {
      const { workspace } = await setup();
      const member = await memberWithRole(workspace.id, 'member');
      const review = await createReview(workspace.id, member);
      const one = reviewsUrl(workspace.id, `/${review.number}`);

      const res = await call('PATCH', one, member, { title: 'Mine' });
      expect(res.statusCode).toBe(200);
      expect(ReviewSchema.parse(res.json()).title).toBe('Mine');
      expect((await call('DELETE', one, member)).statusCode).toBe(204);
    });

    it("refuses a member editing another member's review", async () => {
      const { workspace } = await setup();
      const author = await memberWithRole(workspace.id, 'member');
      const other = await memberWithRole(workspace.id, 'member');
      const review = await createReview(workspace.id, author);
      const one = reviewsUrl(workspace.id, `/${review.number}`);

      const res = await call('PATCH', one, other, { title: 'Not mine' });
      expect(res.statusCode).toBe(403);
      expect(errorOf(res).code).toBe('forbidden');
      expect((await call('DELETE', one, other)).statusCode).toBe(403);
    });

    it("lets an admin edit anyone's review", async () => {
      const { workspace } = await setup();
      const author = await memberWithRole(workspace.id, 'member');
      const admin = await memberWithRole(workspace.id, 'admin');
      const review = await createReview(workspace.id, author);

      const res = await call('PATCH', reviewsUrl(workspace.id, `/${review.number}`), admin, {
        title: 'Edited by admin',
      });
      expect(res.statusCode).toBe(200);
      expect(ReviewSchema.parse(res.json())).toMatchObject({
        title: 'Edited by admin',
        author: { id: author.id },
      });
    });
  });

  describe('workspace isolation', () => {
    it('gives a non-member the same 404 as a missing workspace on every route', async () => {
      const { owner, workspace, review } = await setup();
      const fileId = await firstFileId(workspace.id, review, owner);
      const outsider = await createUserWithSession(app.db);
      const one = reviewsUrl(workspace.id, `/${review.number}`);

      const responses = await Promise.all([
        call('POST', reviewsUrl(workspace.id), outsider, { title: 'T', patch: PATCH }),
        call('GET', reviewsUrl(workspace.id), outsider),
        call('GET', one, outsider),
        call('PATCH', one, outsider, { title: 'x' }),
        call('DELETE', one, outsider),
        call('GET', `${one}/files`, outsider),
        call('GET', `${one}/files/${fileId}/diff`, outsider),
      ]);
      const missing = await call('GET', reviewsUrl(randomUUID()), outsider);
      for (const res of responses) {
        expect(res.statusCode).toBe(404);
        expect(res.json()).toEqual(missing.json());
      }
    });

    it("can't reach a review of workspace B through workspace A", async () => {
      const a = await setup();
      const b = await setup();
      const bReview = await createReview(b.workspace.id, b.owner);
      // a.owner is also a member of B, so this only tests the URL's workspace scoping.
      await addMember(app.db, b.workspace.id, a.owner.id, 'owner');
      const fileId = await firstFileId(b.workspace.id, bReview, b.owner);
      const one = reviewsUrl(a.workspace.id, `/${bReview.number}`);

      for (const res of await Promise.all([
        call('GET', one, a.owner),
        call('PATCH', one, a.owner, { title: 'x' }),
        call('DELETE', one, a.owner),
        call('GET', `${one}/files`, a.owner),
      ])) {
        expect(res.statusCode).toBe(404);
        expect(errorOf(res).code).toBe('review_not_found');
      }

      const diff = await call(
        'GET',
        reviewsUrl(a.workspace.id, `/${a.review.number}/files/${fileId}/diff`),
        a.owner,
      );
      expect(diff.statusCode).toBe(404);
      expect(errorOf(diff).code).toBe('review_file_not_found');
      const after = await call('GET', reviewsUrl(b.workspace.id, `/${bReview.number}`), b.owner);
      expect(ReviewSchema.parse(after.json())).toEqual(bReview);
    });

    it.each(['0', '-1', '1.5', 'abc', '01', '2147483648', '99999999999', `${randomUUID()}`])(
      'answers 404 review_not_found for review number %j',
      async (reviewNumber) => {
        const { owner, workspace } = await setup();
        for (const method of ['GET', 'PATCH', 'DELETE'] as const) {
          const res = await call(
            method,
            reviewsUrl(workspace.id, `/${reviewNumber}`),
            owner,
            method === 'PATCH' ? { title: 'x' } : undefined,
          );
          expect(res.statusCode).toBe(404);
          expect(errorOf(res).code).toBe('review_not_found');
        }
      },
    );

    it('answers 404 review_not_found for the largest int4 number that has no review', async () => {
      const { owner, workspace } = await setup();
      const res = await call('GET', reviewsUrl(workspace.id, '/2147483647'), owner);
      expect(res.statusCode).toBe(404);
      expect(errorOf(res).code).toBe('review_not_found');
    });
  });

  describe('POST /reviews', () => {
    it('creates a review and answers 201 with the Review', async () => {
      const { owner, workspace } = await setup();
      const res = await call('POST', reviewsUrl(workspace.id), owner, {
        title: '  Second  ',
        description: 'Why',
        patch: PATCH,
      });
      expect(res.statusCode).toBe(201);
      const review = ReviewSchema.parse(res.json());
      expect(review).toMatchObject({
        workspaceId: workspace.id,
        number: 2,
        title: 'Second',
        description: 'Why',
        status: 'open',
        author: { id: owner.id, displayName: 'Test' },
        filesChanged: 2,
        additions: 2,
        deletions: 1,
      });
      expect(Object.keys(res.json() as object).sort()).toEqual(
        Object.keys(ReviewSchema.shape).sort(),
      );
    });

    it.each([
      ['a missing title', { title: undefined }],
      ['a blank title', { title: '   ' }],
      ['a title over 200 characters', { title: 'x'.repeat(201) }],
      ['a description over 10,000 characters', { description: 'x'.repeat(10_001) }],
      ['a missing patch', { patch: undefined }],
      ['an empty patch', { patch: '' }],
      ['a NUL in the title', { title: 'a\0b' }],
    ])('answers 422 for %s', async (_, overrides) => {
      const { owner, workspace } = await setup();
      const res = await call('POST', reviewsUrl(workspace.id), owner, {
        title: 'T',
        patch: PATCH,
        ...overrides,
      });
      expect(res.statusCode).toBe(422);
      expect(errorOf(res).code).toBe('validation_error');
    });

    it('answers 400 invalid_patch with the reason and line for a broken patch', async () => {
      const { owner, workspace } = await setup();
      const broken = '--- a/x\n+++ b/x\n@@ -1,2 +1,2 @@\n-a\n+b\n';
      const res = await call('POST', reviewsUrl(workspace.id), owner, {
        title: 'T',
        patch: broken,
      });
      expect(res.statusCode).toBe(400);
      expect(errorOf(res)).toMatchObject({
        code: 'invalid_patch',
        details: { reason: 'count_mismatch', line: expect.any(Number) },
      });
    });

    it('answers 400 invalid_patch with reason not_a_patch for plain text', async () => {
      const { owner, workspace } = await setup();
      const res = await call('POST', reviewsUrl(workspace.id), owner, {
        title: 'T',
        patch: 'hello world',
      });
      expect(res.statusCode).toBe(400);
      expect(errorOf(res).details).toMatchObject({ reason: 'not_a_patch' });
    });

    it('answers 400 unsupported_encoding for NUL characters and stores nothing', async () => {
      const { owner, workspace } = await setup();
      const res = await call('POST', reviewsUrl(workspace.id), owner, {
        title: 'T',
        patch: '-\0-\0-\0 \0a\0\n',
      });
      expect(res.statusCode).toBe(400);
      expect(errorOf(res)).toMatchObject({
        code: 'invalid_patch',
        message: expect.stringContaining('NUL characters') as string,
        details: { reason: 'unsupported_encoding', line: 1 },
      });
      const rows = await app.db
        .select({ id: reviews.id })
        .from(reviews)
        .where(eq(reviews.workspaceId, workspace.id));
      expect(rows).toHaveLength(1);
    });

    it('accepts a patch with a leading BOM', async () => {
      const { owner, workspace } = await setup();
      const review = await createReview(workspace.id, owner, { patch: `${BOM}${PATCH}` });
      expect(review.filesChanged).toBe(2);
    });

    it('answers 413 for a body over the route limit', async () => {
      const { owner, workspace } = await setup();
      const body = JSON.stringify({ title: 'T', patch: 'x'.repeat(CREATE_REVIEW_BODY_LIMIT) });
      const res = await call('POST', reviewsUrl(workspace.id), owner, body);
      expect(res.statusCode).toBe(413);
      expect(errorOf(res).code).toBe('payload_too_large');
    });

    it('accepts a ~1 MB patch whose JSON is larger than the global 1 MiB body limit', async () => {
      const { owner, workspace } = await setup();
      // 60 bytes per line with its newline; each quote doubles in JSON, so the body grows by half.
      const line = `+${'"'.repeat(30)}${'x'.repeat(28)}`;
      const count = 17_400;
      const patch = `--- /dev/null\n+++ b/big.txt\n@@ -0,0 +1,${count} @@\n${`${line}\n`.repeat(count)}`;
      const body = JSON.stringify({ title: 'Big', patch });
      expect(Buffer.byteLength(patch)).toBeGreaterThan(1_000_000);
      expect(Buffer.byteLength(patch)).toBeLessThanOrEqual(1024 * 1024);
      expect(Buffer.byteLength(body)).toBeGreaterThan(1024 * 1024);

      const res = await call('POST', reviewsUrl(workspace.id), owner, body);
      expect(res.statusCode).toBe(201);
      expect(ReviewSchema.parse(res.json())).toMatchObject({ additions: count, filesChanged: 1 });
    });

    it('keeps the global body limit on other routes', async () => {
      const { owner, workspace, review } = await setup();
      const body = JSON.stringify({ title: 'x'.repeat(1024 * 1024 + 1) });
      const res = await call('PATCH', reviewsUrl(workspace.id, `/${review.number}`), owner, body);
      expect(res.statusCode).toBe(413);
    });
  });

  describe('GET /reviews', () => {
    async function list(workspaceId: string, user: TestUser, query = '') {
      const res = await call('GET', `${reviewsUrl(workspaceId)}${query}`, user);
      expect(res.statusCode).toBe(200);
      return ReviewListResponseSchema.parse(res.json());
    }

    it('lists newest first and filters by status and author=me', async () => {
      const { owner, workspace, review: first } = await setup();
      const member = await memberWithRole(workspace.id, 'member');
      const second = await createReview(workspace.id, member);
      const third = await createReview(workspace.id, owner);
      await call('PATCH', reviewsUrl(workspace.id, `/${third.number}`), owner, {
        status: 'closed',
      });

      const all = await list(workspace.id, owner);
      expect(all.items.map((r) => r.number)).toEqual([3, 2, 1]);
      expect(all.nextCursor).toBeNull();

      const open = await list(workspace.id, owner, '?status=open');
      expect(open.items.map((r) => r.id)).toEqual([second.id, first.id]);
      const closed = await list(workspace.id, owner, '?status=closed');
      expect(closed.items.map((r) => r.id)).toEqual([third.id]);

      const mine = await list(workspace.id, member, '?author=me');
      expect(mine.items.map((r) => r.id)).toEqual([second.id]);
      const byOwner = await list(workspace.id, member, `?author=${owner.id}&status=open`);
      expect(byOwner.items.map((r) => r.id)).toEqual([first.id]);
    });

    it('applies limit and returns a cursor when more remain', async () => {
      const { owner, workspace } = await setup();
      await createReview(workspace.id, owner);
      const page = await list(workspace.id, owner, '?limit=1');
      expect(page.items).toHaveLength(1);
      expect(page.nextCursor).toEqual(expect.any(String));
    });

    it.each(['?limit=0', '?limit=51', '?limit=abc', '?status=approved', '?author=someone'])(
      'answers 422 validation_error for %s',
      async (query) => {
        const { owner, workspace } = await setup();
        const res = await call('GET', `${reviewsUrl(workspace.id)}${query}`, owner);
        expect(res.statusCode).toBe(422);
        expect(errorOf(res).code).toBe('validation_error');
      },
    );

    it.each([
      'garbage',
      'not base64!',
      Buffer.from('{"createdAt":"x","id":"y"}').toString('base64url'),
      Buffer.from(
        JSON.stringify({ createdAt: '2026-02-30T00:00:00.000000Z', id: randomUUID() }),
      ).toString('base64url'),
    ])('answers 400 invalid_cursor for cursor %j', async (cursor) => {
      const { owner, workspace } = await setup();
      const res = await call(
        'GET',
        `${reviewsUrl(workspace.id)}?cursor=${encodeURIComponent(cursor)}`,
        owner,
      );
      expect(res.statusCode).toBe(400);
      expect(errorOf(res).code).toBe('invalid_cursor');
    });

    async function pageThrough(workspaceId: string, user: TestUser, limit: number) {
      const ids: string[] = [];
      const pages: number[] = [];
      let cursor: string | null = null;
      do {
        const query: string = `?limit=${limit}${cursor ? `&cursor=${cursor}` : ''}`;
        const page = await list(workspaceId, user, query);
        ids.push(...page.items.map((r) => r.id));
        pages.push(page.items.length);
        cursor = page.nextCursor;
      } while (cursor !== null && pages.length < 100);
      return { ids, pages };
    }

    it('pages through reviews created in parallel without duplicates or gaps', async () => {
      const owner = await createUserWithSession(app.db);
      const workspace = await createWorkspace(owner);
      await Promise.all(Array.from({ length: 25 }, () => createReview(workspace.id, owner)));

      const { ids, pages } = await pageThrough(workspace.id, owner, 10);
      expect(pages).toEqual([10, 10, 5]);
      expect(new Set(ids).size).toBe(25);

      const expected = await app.db.execute<{ id: string; created_at: string }>(
        sql`select id, created_at::text as created_at from reviews
            where workspace_id = ${workspace.id} order by created_at desc, id desc`,
      );
      expect(ids).toEqual(expected.rows.map((row) => row.id));
      for (let k = 1; k < expected.rows.length; k++) {
        const [prev, cur] = [expected.rows[k - 1]!, expected.rows[k]!];
        expect(
          prev.created_at > cur.created_at ||
            (prev.created_at === cur.created_at && prev.id > cur.id),
        ).toBe(true);
      }
    });

    it('keeps microsecond precision in the cursor (rows in one millisecond)', async () => {
      const owner = await createUserWithSession(app.db);
      const workspace = await createWorkspace(owner);
      const created = [];
      for (let k = 0; k < 4; k++) created.push(await createReview(workspace.id, owner));
      // Same millisecond, different microseconds; the last two share the exact timestamp.
      const stamps = [
        '2026-01-01 00:00:00.000100+00',
        '2026-01-01 00:00:00.000900+00',
        '2026-01-01 00:00:00.000500+00',
        '2026-01-01 00:00:00.000500+00',
      ];
      for (const [k, review] of created.entries()) {
        await app.db.execute(
          sql`update reviews set created_at = ${stamps[k]}::timestamptz where id = ${review.id}`,
        );
      }

      const { ids } = await pageThrough(workspace.id, owner, 1);
      const sameStamp = [created[2]!.id, created[3]!.id].sort().reverse();
      expect(ids).toEqual([created[1]!.id, ...sameStamp, created[0]!.id]);

      const first = await list(workspace.id, owner, '?limit=1');
      const decoded: unknown = JSON.parse(
        Buffer.from(first.nextCursor!, 'base64url').toString('utf8'),
      );
      expect(decoded).toEqual({ createdAt: '2026-01-01T00:00:00.000900Z', id: created[1]!.id });
    });
  });

  describe('GET /reviews/:reviewNumber', () => {
    it('returns the review', async () => {
      const { owner, workspace, review } = await setup();
      const res = await call('GET', reviewsUrl(workspace.id, `/${review.number}`), owner);
      expect(res.statusCode).toBe(200);
      expect(ReviewSchema.parse(res.json())).toEqual(review);
    });

    it('answers 404 review_not_found for a number that does not exist', async () => {
      const { owner, workspace } = await setup();
      const res = await call('GET', reviewsUrl(workspace.id, '/2'), owner);
      expect(res.statusCode).toBe(404);
      expect(errorOf(res).code).toBe('review_not_found');
    });
  });

  describe('PATCH /reviews/:reviewNumber', () => {
    it('closes and reopens a review', async () => {
      const { owner, workspace, review } = await setup();
      const url = reviewsUrl(workspace.id, `/${review.number}`);

      const closed = await call('PATCH', url, owner, { status: 'closed' });
      expect(closed.statusCode).toBe(200);
      expect(ReviewSchema.parse(closed.json())).toEqual({ ...review, status: 'closed' });

      const reopened = await call('PATCH', url, owner, { status: 'open' });
      expect(ReviewSchema.parse(reopened.json())).toEqual(review);
    });

    it('updates title and clears the description', async () => {
      const { owner, workspace } = await setup();
      const review = await createReview(workspace.id, owner, { description: 'Old' });
      const res = await call('PATCH', reviewsUrl(workspace.id, `/${review.number}`), owner, {
        title: '  New  ',
        description: null,
      });
      expect(ReviewSchema.parse(res.json())).toEqual({
        ...review,
        title: 'New',
        description: null,
      });
    });

    it.each([
      ['an empty body', {}],
      ['only unknown fields', { patch: PATCH }],
      ['a blank title', { title: ' ' }],
      ['an unknown status', { status: 'approved' }],
      ['merged, which only the merge action sets', { status: 'merged' }],
    ])('answers 422 for %s', async (_, body) => {
      const { owner, workspace, review } = await setup();
      const res = await call('PATCH', reviewsUrl(workspace.id, `/${review.number}`), owner, body);
      expect(res.statusCode).toBe(422);
      expect(errorOf(res).code).toBe('validation_error');
    });
  });

  describe('DELETE /reviews/:reviewNumber', () => {
    it('deletes the review and its files', async () => {
      const { owner, workspace, review } = await setup();
      const url = reviewsUrl(workspace.id, `/${review.number}`);

      const res = await call('DELETE', url, owner);
      expect(res.statusCode).toBe(204);
      expect(res.body).toBe('');

      expect((await call('GET', url, owner)).statusCode).toBe(404);
      const files = await app.db
        .select({ id: reviewFiles.id })
        .from(reviewFiles)
        .where(eq(reviewFiles.reviewId, review.id));
      expect(files).toEqual([]);
      expect((await createReview(workspace.id, owner)).number).toBe(2);
    });
  });

  describe('files and diff', () => {
    it('lists files in patch order without hunks', async () => {
      const { owner, workspace, review } = await setup();
      const res = await call('GET', reviewsUrl(workspace.id, `/${review.number}/files`), owner);
      expect(res.statusCode).toBe(200);
      const body = res.json() as Record<string, unknown>[];
      expect(body.map((f) => [f.position, f.newPath, f.changeType])).toEqual([
        [0, 'src/app.ts', 'modified'],
        [1, 'src/new.ts', 'added'],
      ]);
      for (const file of body) expect(file).not.toHaveProperty('hunks');
    });

    it('returns one file with its hunks', async () => {
      const { owner, workspace, review } = await setup();
      const filesRes = await call(
        'GET',
        reviewsUrl(workspace.id, `/${review.number}/files`),
        owner,
      );
      const [, added] = ReviewFileSchema.array().parse(filesRes.json());

      const res = await call(
        'GET',
        reviewsUrl(workspace.id, `/${review.number}/files/${added!.id}/diff`),
        owner,
      );
      expect(res.statusCode).toBe(200);
      const diff = ReviewFileDiffSchema.parse(res.json());
      expect(diff.file).toEqual(added);
      expect(diff.hunks).toHaveLength(1);
      expect(diff.hunks[0]!.lines.map((l) => l.content)).toEqual(['export const x = 1;']);
    });

    it.each([
      ['a malformed fileId', () => 'not-a-uuid'],
      ['an unknown fileId', () => randomUUID()],
    ])('answers 404 review_file_not_found for %s', async (_, fileId) => {
      const { owner, workspace, review } = await setup();
      const res = await call(
        'GET',
        reviewsUrl(workspace.id, `/${review.number}/files/${fileId()}/diff`),
        owner,
      );
      expect(res.statusCode).toBe(404);
      expect(errorOf(res).code).toBe('review_file_not_found');
    });

    it('answers 404 review_file_not_found for a file of another review', async () => {
      const { owner, workspace, review } = await setup();
      const other = await createReview(workspace.id, owner);
      const otherFileId = await firstFileId(workspace.id, other, owner);

      const res = await call(
        'GET',
        reviewsUrl(workspace.id, `/${review.number}/files/${otherFileId}/diff`),
        owner,
      );
      expect(res.statusCode).toBe(404);
      expect(errorOf(res).code).toBe('review_file_not_found');
    });
  });
});
