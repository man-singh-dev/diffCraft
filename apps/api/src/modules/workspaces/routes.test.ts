import { randomUUID } from 'node:crypto';
import {
  ErrorResponseSchema,
  type WorkspaceRole,
  type Workspace,
  WorkspaceSchema,
} from '@diffcraft/shared';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';
import { workspaceMembers, workspaces } from '../../db/schema/index.js';
import { describeWithDb, testDatabaseUrl } from '../../test/db.js';
import { addMember, createUserWithSession, type TestUser } from '../../test/fixtures.js';

const BASE = '/api/v1/workspaces';
const WORKSPACE_NOT_FOUND = {
  error: { code: 'workspace_not_found', message: 'Workspace not found.' },
};

type Method = 'GET' | 'PATCH' | 'DELETE';
type Caller = 'logged out' | 'non-member' | WorkspaceRole;

// Expected status per method and caller: the authorization matrix.
const MATRIX: Record<Method, Record<Caller, number>> = {
  GET: { 'logged out': 401, 'non-member': 404, viewer: 200, member: 200, admin: 200, owner: 200 },
  PATCH: { 'logged out': 401, 'non-member': 404, viewer: 403, member: 403, admin: 200, owner: 200 },
  DELETE: {
    'logged out': 401,
    'non-member': 404,
    viewer: 403,
    member: 403,
    admin: 403,
    owner: 204,
  },
};

describeWithDb('workspace routes', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp(
      loadConfig({ LOG_LEVEL: 'silent', NODE_ENV: 'test', DATABASE_URL: testDatabaseUrl }),
    );
  });

  afterAll(async () => {
    await app.close();
  });

  const uniqueName = () => `Team ${randomUUID()}`;

  const call = (method: Method | 'POST', url: string, user?: TestUser, payload?: object) =>
    app.inject({
      method,
      url,
      ...(user && { cookies: user.cookies }),
      ...(payload && { payload }),
    });

  /** Creates a workspace through the API, owned by `owner`. */
  async function createWorkspace(owner: TestUser): Promise<Workspace> {
    const res = await call('POST', BASE, owner, { name: uniqueName() });
    expect(res.statusCode).toBe(201);
    return WorkspaceSchema.parse(res.json());
  }

  const storedWorkspace = async (id: string) => {
    const [row] = await app.db.select().from(workspaces).where(eq(workspaces.id, id));
    return row;
  };

  describe('authorization matrix for /:workspaceId', () => {
    const callers: Caller[] = ['logged out', 'non-member', 'viewer', 'member', 'admin', 'owner'];
    const cases = (['GET', 'PATCH', 'DELETE'] as const).flatMap((method) =>
      callers.map((caller) => ({ method, caller, expected: MATRIX[method][caller] })),
    );

    it.each(cases)('$method as $caller → $expected', async ({ method, caller, expected }) => {
      const owner = await createUserWithSession(app.db);
      const workspace = await createWorkspace(owner);

      let user: TestUser | undefined;
      if (caller === 'owner') user = owner;
      else if (caller !== 'logged out') {
        user = await createUserWithSession(app.db);
        if (caller !== 'non-member') await addMember(app.db, workspace.id, user.id, caller);
      }

      const payload = method === 'PATCH' ? { name: 'Renamed' } : undefined;
      const res = await call(method, `${BASE}/${workspace.id}`, user, payload);

      expect(res.statusCode).toBe(expected);
      if (expected === 401) expect(res.json().error.code).toBe('unauthenticated');
      if (expected === 404) expect(res.json()).toEqual(WORKSPACE_NOT_FOUND);
      if (expected === 403) expect(res.json().error.code).toBe('forbidden');
      if (expected === 200) {
        const role = caller as WorkspaceRole;
        expect(WorkspaceSchema.parse(res.json())).toMatchObject({ id: workspace.id, role });
      }

      // Denied requests must not change anything.
      const row = await storedWorkspace(workspace.id);
      if (expected === 204) expect(row).toBeUndefined();
      else if (expected === 200 && method === 'PATCH') expect(row?.name).toBe('Renamed');
      else expect(row?.name).toBe(workspace.name);
    });
  });

  it("IDOR: user B gets 404 on user A's workspace, which stays unchanged", async () => {
    const alice = await createUserWithSession(app.db);
    const bob = await createUserWithSession(app.db);
    const workspace = await createWorkspace(alice);
    const url = `${BASE}/${workspace.id}`;

    for (const res of [
      await call('GET', url, bob),
      await call('PATCH', url, bob, { name: 'Hijacked' }),
      await call('DELETE', url, bob),
    ]) {
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual(WORKSPACE_NOT_FOUND);
    }

    const row = await storedWorkspace(workspace.id);
    expect(row).toMatchObject({ name: workspace.name, slug: workspace.slug });
    const members = await app.db
      .select()
      .from(workspaceMembers)
      .where(eq(workspaceMembers.workspaceId, workspace.id));
    expect(members).toEqual([expect.objectContaining({ userId: alice.id, role: 'owner' })]);
  });

  it('gives a non-member exactly the same 404 body as a non-existent workspace', async () => {
    const alice = await createUserWithSession(app.db);
    const bob = await createUserWithSession(app.db);
    const workspace = await createWorkspace(alice);

    const notMember = await call('GET', `${BASE}/${workspace.id}`, bob);
    const missing = await call('GET', `${BASE}/${randomUUID()}`, bob);

    expect(notMember.statusCode).toBe(404);
    expect(missing.statusCode).toBe(404);
    expect(notMember.body).toBe(missing.body);
    expect(notMember.headers['content-type']).toBe(missing.headers['content-type']);
  });

  it('returns 404 (not 500) for an id that is not a UUID', async () => {
    const user = await createUserWithSession(app.db);
    for (const method of ['GET', 'PATCH', 'DELETE'] as const) {
      const res = await call(
        method,
        `${BASE}/abc`,
        user,
        method === 'PATCH' ? { name: 'x' } : undefined,
      );
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual(WORKSPACE_NOT_FOUND);
    }
  });

  it('POST / creates a workspace with the caller as owner', async () => {
    const user = await createUserWithSession(app.db);
    const name = uniqueName();

    const res = await call('POST', BASE, user, { name: `  ${name}  ` });

    expect(res.statusCode).toBe(201);
    expect(WorkspaceSchema.strict().parse(res.json())).toMatchObject({ name, role: 'owner' });
  });

  it("GET / lists only the caller's workspaces, with their role", async () => {
    const alice = await createUserWithSession(app.db);
    const bob = await createUserWithSession(app.db);
    const own = await createWorkspace(alice);
    const shared = await createWorkspace(bob);
    const bobsOnly = await createWorkspace(bob);
    await addMember(app.db, shared.id, alice.id, 'member');

    const res = await call('GET', BASE, alice);

    expect(res.statusCode).toBe(200);
    const list = WorkspaceSchema.array().parse(res.json());
    expect(list.map((w) => [w.id, w.role])).toEqual([
      [shared.id, 'member'],
      [own.id, 'owner'],
    ]);
    expect(list.map((w) => w.id)).not.toContain(bobsOnly.id);
  });

  it('GET / returns 401 when logged out', async () => {
    expect((await call('GET', BASE)).statusCode).toBe(401);
  });

  it('PATCH keeps the slug', async () => {
    const owner = await createUserWithSession(app.db);
    const workspace = await createWorkspace(owner);

    const res = await call('PATCH', `${BASE}/${workspace.id}`, owner, { name: '  New name  ' });

    expect(res.statusCode).toBe(200);
    expect(WorkspaceSchema.parse(res.json())).toMatchObject({
      name: 'New name',
      slug: workspace.slug,
    });
    expect((await storedWorkspace(workspace.id))?.slug).toBe(workspace.slug);
  });

  it('DELETE removes the workspace and its memberships', async () => {
    const owner = await createUserWithSession(app.db);
    const member = await createUserWithSession(app.db);
    const workspace = await createWorkspace(owner);
    await addMember(app.db, workspace.id, member.id, 'member');

    const res = await call('DELETE', `${BASE}/${workspace.id}`, owner);

    expect(res.statusCode).toBe(204);
    expect(res.body).toBe('');
    expect(await storedWorkspace(workspace.id)).toBeUndefined();
    const members = await app.db
      .select()
      .from(workspaceMembers)
      .where(eq(workspaceMembers.workspaceId, workspace.id));
    expect(members).toEqual([]);
    expect((await call('GET', `${BASE}/${workspace.id}`, owner)).statusCode).toBe(404);
  });

  it.each([
    ['POST', 'empty name', { name: '   ' }],
    ['POST', 'missing name', {}],
    ['POST', 'name over 80 characters', { name: 'a'.repeat(81) }],
    ['PATCH', 'empty name', { name: '' }],
    ['PATCH', 'missing name', {}],
  ] as const)('%s with %s → 422', async (method, _label, payload) => {
    const owner = await createUserWithSession(app.db);
    const url = method === 'POST' ? BASE : `${BASE}/${(await createWorkspace(owner)).id}`;

    const res = await call(method, url, owner, payload);

    expect(res.statusCode).toBe(422);
    const { error } = ErrorResponseSchema.parse(res.json());
    expect(error.code).toBe('validation_error');
    expect(error.details).toEqual([expect.objectContaining({ field: 'name' })]);
  });

  it('rejects POST, PATCH and DELETE from a foreign Origin (CSRF check)', async () => {
    const owner = await createUserWithSession(app.db);
    const workspace = await createWorkspace(owner);
    const url = `${BASE}/${workspace.id}`;
    const headers = { origin: 'https://evil.example' };

    for (const [method, target, payload] of [
      ['POST', BASE, { name: uniqueName() }],
      ['PATCH', url, { name: 'Hijacked' }],
      ['DELETE', url, undefined],
    ] as const) {
      const res = await app.inject({
        method,
        url: target,
        cookies: owner.cookies,
        headers,
        payload,
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe('forbidden_origin');
    }
    expect((await storedWorkspace(workspace.id))?.name).toBe(workspace.name);
  });
});
