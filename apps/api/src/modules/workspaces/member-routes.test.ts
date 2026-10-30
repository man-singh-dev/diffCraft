import { randomUUID } from 'node:crypto';
import {
  ErrorResponseSchema,
  type Workspace,
  WorkspaceMemberSchema,
  type WorkspaceRole,
  WorkspaceSchema,
} from '@diffcraft/shared';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';
import { workspaceMembers } from '../../db/schema/index.js';
import { describeWithDb, testDatabaseUrl } from '../../test/db.js';
import { addMember, createUserWithSession, type TestUser } from '../../test/fixtures.js';

const BASE = '/api/v1/workspaces';
const CONCURRENCY_RUNS = 10;

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';
type Endpoint = 'list' | 'add' | 'change role' | 'remove' | 'leave';
type Caller = 'logged out' | 'non-member' | WorkspaceRole;

// Expected status per endpoint and caller: the authorization matrix. The owner is the only
// owner, so leaving is the last-owner case.
const MATRIX: Record<Endpoint, Record<Caller, number>> = {
  list: { 'logged out': 401, 'non-member': 404, viewer: 200, member: 200, admin: 200, owner: 200 },
  add: { 'logged out': 401, 'non-member': 404, viewer: 403, member: 403, admin: 201, owner: 201 },
  'change role': {
    'logged out': 401,
    'non-member': 404,
    viewer: 403,
    member: 403,
    admin: 200,
    owner: 200,
  },
  remove: {
    'logged out': 401,
    'non-member': 404,
    viewer: 403,
    member: 403,
    admin: 204,
    owner: 204,
  },
  leave: { 'logged out': 401, 'non-member': 404, viewer: 204, member: 204, admin: 204, owner: 409 },
};

describeWithDb('workspace member routes', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp(
      loadConfig({ LOG_LEVEL: 'silent', NODE_ENV: 'test', DATABASE_URL: testDatabaseUrl }),
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
      ...(payload && { payload }),
    });

  const membersUrl = (workspaceId: string, userId?: string) =>
    `${BASE}/${workspaceId}/members${userId ? `/${userId}` : ''}`;

  async function createWorkspace(owner: TestUser): Promise<Workspace> {
    const res = await call('POST', BASE, owner, { name: `Team ${randomUUID()}` });
    expect(res.statusCode).toBe(201);
    return WorkspaceSchema.parse(res.json());
  }

  /** A new user who is a member of `workspaceId` with `role`. */
  async function memberWithRole(workspaceId: string, role: WorkspaceRole): Promise<TestUser> {
    const user = await createUserWithSession(app.db);
    await addMember(app.db, workspaceId, user.id, role);
    return user;
  }

  async function storedRole(workspaceId: string, userId: string) {
    const [row] = await app.db
      .select({ role: workspaceMembers.role })
      .from(workspaceMembers)
      .where(
        and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)),
      );
    return row?.role ?? null;
  }

  async function storedOwners(workspaceId: string) {
    const rows = await app.db
      .select({ userId: workspaceMembers.userId })
      .from(workspaceMembers)
      .where(
        and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.role, 'owner')),
      );
    return rows.map((row) => row.userId);
  }

  const errorCode = (res: { json: () => unknown }) =>
    ErrorResponseSchema.parse(res.json()).error.code;

  describe('authorization matrix', () => {
    const callers: Caller[] = ['logged out', 'non-member', 'viewer', 'member', 'admin', 'owner'];
    const endpoints = Object.keys(MATRIX) as Endpoint[];
    const cases = endpoints.flatMap((endpoint) =>
      callers.map((caller) => ({ endpoint, caller, expected: MATRIX[endpoint][caller] })),
    );

    it.each(cases)('$endpoint as $caller → $expected', async ({ endpoint, caller, expected }) => {
      const owner = await createUserWithSession(app.db);
      const workspace = await createWorkspace(owner);
      // The member that change role and remove act on, and the user that add adds.
      const target = await memberWithRole(workspace.id, 'viewer');
      const newcomer = await createUserWithSession(app.db);

      let user: TestUser | undefined;
      if (caller === 'owner') user = owner;
      else if (caller === 'non-member') user = await createUserWithSession(app.db);
      else if (caller !== 'logged out') user = await memberWithRole(workspace.id, caller);

      const res = await {
        list: () => call('GET', membersUrl(workspace.id), user),
        add: () =>
          call('POST', membersUrl(workspace.id), user, { email: newcomer.email, role: 'member' }),
        'change role': () =>
          call('PATCH', membersUrl(workspace.id, target.id), user, { role: 'member' }),
        remove: () => call('DELETE', membersUrl(workspace.id, target.id), user),
        leave: () => call('POST', `${membersUrl(workspace.id)}/leave`, user),
      }[endpoint]();

      expect(res.statusCode).toBe(expected);
      if (expected === 401) expect(errorCode(res)).toBe('unauthenticated');
      if (expected === 404) expect(errorCode(res)).toBe('workspace_not_found');
      if (expected === 403) expect(errorCode(res)).toBe('forbidden');
      if (expected === 409) expect(errorCode(res)).toBe('last_owner');

      // Only a successful call changes anything.
      const ok = expected < 300;
      expect(await storedRole(workspace.id, newcomer.id)).toBe(
        endpoint === 'add' && ok ? 'member' : null,
      );
      let targetRole: WorkspaceRole | null = 'viewer';
      if (ok && endpoint === 'change role') targetRole = 'member';
      if (ok && endpoint === 'remove') targetRole = null;
      expect(await storedRole(workspace.id, target.id)).toBe(targetRole);
      if (endpoint === 'leave' && user && caller !== 'non-member') {
        expect(await storedRole(workspace.id, user.id)).toBe(ok ? null : caller);
      }
    });
  });

  describe('GET /', () => {
    it('lists owners first, then by join date, with user details', async () => {
      const owner = await createUserWithSession(app.db);
      const workspace = await createWorkspace(owner);
      const member = await memberWithRole(workspace.id, 'member');
      const secondOwner = await memberWithRole(workspace.id, 'owner');
      const viewer = await memberWithRole(workspace.id, 'viewer');

      const res = await call('GET', membersUrl(workspace.id), viewer);

      expect(res.statusCode).toBe(200);
      const list = WorkspaceMemberSchema.strict().array().parse(res.json());
      expect(list.map((m) => [m.userId, m.role])).toEqual([
        [owner.id, 'owner'],
        [secondOwner.id, 'owner'],
        [member.id, 'member'],
        [viewer.id, 'viewer'],
      ]);
      expect(list[0]).toMatchObject({ email: owner.email, displayName: 'Test' });
    });
  });

  describe('POST / (add by email)', () => {
    it('adds an existing user, matching the email case-insensitively', async () => {
      const owner = await createUserWithSession(app.db);
      const workspace = await createWorkspace(owner);
      const newcomer = await createUserWithSession(app.db);

      const res = await call('POST', membersUrl(workspace.id), owner, {
        email: `  ${newcomer.email.toUpperCase()}  `,
        role: 'admin',
      });

      expect(res.statusCode).toBe(201);
      expect(WorkspaceMemberSchema.strict().parse(res.json())).toMatchObject({
        userId: newcomer.id,
        email: newcomer.email,
        role: 'admin',
      });
      expect(await storedRole(workspace.id, newcomer.id)).toBe('admin');
    });

    it('returns 404 user_not_found for an unknown email', async () => {
      const owner = await createUserWithSession(app.db);
      const workspace = await createWorkspace(owner);

      const res = await call('POST', membersUrl(workspace.id), owner, {
        email: `nobody-${randomUUID()}@example.com`,
        role: 'member',
      });

      expect(res.statusCode).toBe(404);
      expect(errorCode(res)).toBe('user_not_found');
    });

    it('returns 409 already_member and keeps the existing role', async () => {
      const owner = await createUserWithSession(app.db);
      const workspace = await createWorkspace(owner);
      const viewer = await memberWithRole(workspace.id, 'viewer');

      const res = await call('POST', membersUrl(workspace.id), owner, {
        email: viewer.email,
        role: 'admin',
      });

      expect(res.statusCode).toBe(409);
      expect(errorCode(res)).toBe('already_member');
      expect(await storedRole(workspace.id, viewer.id)).toBe('viewer');
    });

    it.each([
      ['an invalid email', { email: 'not-an-email', role: 'member' }, 'email'],
      ['an unknown role', { email: 'a@example.com', role: 'superadmin' }, 'role'],
    ])('returns 422 for %s', async (_label, payload, field) => {
      const owner = await createUserWithSession(app.db);
      const workspace = await createWorkspace(owner);

      const res = await call('POST', membersUrl(workspace.id), owner, payload);

      expect(res.statusCode).toBe(422);
      const { error } = ErrorResponseSchema.parse(res.json());
      expect(error.details).toEqual([expect.objectContaining({ field })]);
    });
  });

  describe('privilege escalation', () => {
    it('an admin cannot add anyone as owner', async () => {
      const owner = await createUserWithSession(app.db);
      const workspace = await createWorkspace(owner);
      const admin = await memberWithRole(workspace.id, 'admin');
      const newcomer = await createUserWithSession(app.db);

      const res = await call('POST', membersUrl(workspace.id), admin, {
        email: newcomer.email,
        role: 'owner',
      });

      expect(res.statusCode).toBe(403);
      expect(errorCode(res)).toBe('forbidden');
      expect(await storedRole(workspace.id, newcomer.id)).toBeNull();
    });

    it('an admin cannot promote anyone, including themselves, to owner', async () => {
      const owner = await createUserWithSession(app.db);
      const workspace = await createWorkspace(owner);
      const admin = await memberWithRole(workspace.id, 'admin');
      const member = await memberWithRole(workspace.id, 'member');

      for (const target of [member, admin]) {
        const res = await call('PATCH', membersUrl(workspace.id, target.id), admin, {
          role: 'owner',
        });
        expect(res.statusCode).toBe(403);
        expect(errorCode(res)).toBe('forbidden');
      }
      expect(await storedRole(workspace.id, member.id)).toBe('member');
      expect(await storedRole(workspace.id, admin.id)).toBe('admin');
    });

    it('an admin cannot demote or remove an owner', async () => {
      const owner = await createUserWithSession(app.db);
      const workspace = await createWorkspace(owner);
      const admin = await memberWithRole(workspace.id, 'admin');
      const url = membersUrl(workspace.id, owner.id);

      for (const res of [
        await call('PATCH', url, admin, { role: 'viewer' }),
        await call('DELETE', url, admin),
      ]) {
        expect(res.statusCode).toBe(403);
        expect(errorCode(res)).toBe('forbidden');
      }
      expect(await storedRole(workspace.id, owner.id)).toBe('owner');
    });

    it('an admin can change and remove other admins', async () => {
      const owner = await createUserWithSession(app.db);
      const workspace = await createWorkspace(owner);
      const admin = await memberWithRole(workspace.id, 'admin');
      const otherAdmin = await memberWithRole(workspace.id, 'admin');
      const url = membersUrl(workspace.id, otherAdmin.id);

      expect((await call('PATCH', url, admin, { role: 'member' })).statusCode).toBe(200);
      expect((await call('PATCH', url, admin, { role: 'admin' })).statusCode).toBe(200);
      expect((await call('DELETE', url, admin)).statusCode).toBe(204);
      expect(await storedRole(workspace.id, otherAdmin.id)).toBeNull();
    });

    it('an owner can promote a member to owner', async () => {
      const owner = await createUserWithSession(app.db);
      const workspace = await createWorkspace(owner);
      const member = await memberWithRole(workspace.id, 'member');

      const res = await call('PATCH', membersUrl(workspace.id, member.id), owner, {
        role: 'owner',
      });

      expect(res.statusCode).toBe(200);
      expect(WorkspaceMemberSchema.parse(res.json())).toMatchObject({
        userId: member.id,
        role: 'owner',
      });
      expect(await storedOwners(workspace.id)).toHaveLength(2);
    });
  });

  describe('last owner', () => {
    it('the only owner cannot demote themselves or leave', async () => {
      const owner = await createUserWithSession(app.db);
      const workspace = await createWorkspace(owner);

      for (const res of [
        await call('PATCH', membersUrl(workspace.id, owner.id), owner, { role: 'admin' }),
        await call('POST', `${membersUrl(workspace.id)}/leave`, owner),
      ]) {
        expect(res.statusCode).toBe(409);
        expect(errorCode(res)).toBe('last_owner');
      }
      expect(await storedOwners(workspace.id)).toEqual([owner.id]);
    });

    it('DELETE on yourself is refused: use /leave', async () => {
      const owner = await createUserWithSession(app.db);
      const workspace = await createWorkspace(owner);
      const admin = await memberWithRole(workspace.id, 'admin');

      for (const user of [owner, admin]) {
        const res = await call('DELETE', membersUrl(workspace.id, user.id), user);
        expect(res.statusCode).toBe(400);
        expect(errorCode(res)).toBe('cannot_remove_self');
      }
      expect(await storedRole(workspace.id, owner.id)).toBe('owner');
      expect(await storedRole(workspace.id, admin.id)).toBe('admin');
    });

    it('with two owners one can leave, and then the other cannot', async () => {
      const ownerA = await createUserWithSession(app.db);
      const workspace = await createWorkspace(ownerA);
      const ownerB = await memberWithRole(workspace.id, 'owner');
      const leave = `${membersUrl(workspace.id)}/leave`;

      expect((await call('POST', leave, ownerA)).statusCode).toBe(204);
      const res = await call('POST', leave, ownerB);

      expect(res.statusCode).toBe(409);
      expect(errorCode(res)).toBe('last_owner');
      expect(await storedOwners(workspace.id)).toEqual([ownerB.id]);
    });

    it('with two owners, one can demote the other', async () => {
      const ownerA = await createUserWithSession(app.db);
      const workspace = await createWorkspace(ownerA);
      const ownerB = await memberWithRole(workspace.id, 'owner');

      const res = await call('PATCH', membersUrl(workspace.id, ownerB.id), ownerA, {
        role: 'member',
      });

      expect(res.statusCode).toBe(200);
      expect(await storedOwners(workspace.id)).toEqual([ownerA.id]);
    });
  });

  describe('concurrency', () => {
    // Without the workspace row lock both transactions would count 2 owners, demote each
    // other, and leave none. With it the second waits, re-reads, and is refused.
    it(`two owners demoting each other at once leaves exactly one owner (${CONCURRENCY_RUNS} runs)`, async () => {
      for (let run = 0; run < CONCURRENCY_RUNS; run++) {
        const ownerA = await createUserWithSession(app.db);
        const workspace = await createWorkspace(ownerA);
        const ownerB = await memberWithRole(workspace.id, 'owner');

        const [aDemotesB, bDemotesA] = await Promise.all([
          call('PATCH', membersUrl(workspace.id, ownerB.id), ownerA, { role: 'admin' }),
          call('PATCH', membersUrl(workspace.id, ownerA.id), ownerB, { role: 'admin' }),
        ]);

        const statuses = [aDemotesB.statusCode, bDemotesA.statusCode];
        expect(
          statuses.filter((s) => s === 200),
          `run ${run}: ${statuses}`,
        ).toHaveLength(1);
        // The loser is an admin by the time its transaction gets the lock, and admins can't
        // touch owners: 403, not 409.
        const loser = aDemotesB.statusCode === 200 ? bDemotesA : aDemotesB;
        expect(loser.statusCode).toBe(403);
        const winner = aDemotesB.statusCode === 200 ? ownerA : ownerB;
        expect(await storedOwners(workspace.id)).toEqual([winner.id]);
      }
    });
  });

  describe(':userId', () => {
    it('returns 404 member_not_found for a non-UUID or a non-member', async () => {
      const owner = await createUserWithSession(app.db);
      const workspace = await createWorkspace(owner);
      const stranger = await createUserWithSession(app.db);

      for (const userId of ['abc', stranger.id, randomUUID()]) {
        const url = membersUrl(workspace.id, userId);
        for (const res of [
          await call('PATCH', url, owner, { role: 'member' }),
          await call('DELETE', url, owner),
        ]) {
          expect(res.statusCode).toBe(404);
          expect(errorCode(res)).toBe('member_not_found');
        }
      }
    });
  });

  describe('IDOR', () => {
    it("an admin of workspace X can't list or change members of workspace Y", async () => {
      const ownerX = await createUserWithSession(app.db);
      const ownerY = await createUserWithSession(app.db);
      const x = await createWorkspace(ownerX);
      const y = await createWorkspace(ownerY);
      const adminX = await memberWithRole(x.id, 'admin');
      const memberY = await memberWithRole(y.id, 'member');
      const newcomer = await createUserWithSession(app.db);

      for (const res of [
        await call('GET', membersUrl(y.id), adminX),
        await call('POST', membersUrl(y.id), adminX, { email: newcomer.email, role: 'member' }),
        await call('PATCH', membersUrl(y.id, memberY.id), adminX, { role: 'viewer' }),
        await call('DELETE', membersUrl(y.id, memberY.id), adminX),
        await call('POST', `${membersUrl(y.id)}/leave`, adminX),
      ]) {
        expect(res.statusCode).toBe(404);
        expect(errorCode(res)).toBe('workspace_not_found');
      }

      // Y's member through X's URL: the target is looked up in X, so it isn't found.
      for (const res of [
        await call('PATCH', membersUrl(x.id, memberY.id), adminX, { role: 'viewer' }),
        await call('DELETE', membersUrl(x.id, memberY.id), adminX),
      ]) {
        expect(res.statusCode).toBe(404);
        expect(errorCode(res)).toBe('member_not_found');
      }

      expect(await storedRole(y.id, memberY.id)).toBe('member');
      expect(await storedRole(y.id, newcomer.id)).toBeNull();
    });
  });

  it('a removed member loses access immediately', async () => {
    const owner = await createUserWithSession(app.db);
    const workspace = await createWorkspace(owner);
    const member = await memberWithRole(workspace.id, 'member');
    expect((await call('GET', `${BASE}/${workspace.id}`, member)).statusCode).toBe(200);

    expect((await call('DELETE', membersUrl(workspace.id, member.id), owner)).statusCode).toBe(204);

    const res = await call('GET', `${BASE}/${workspace.id}`, member);
    expect(res.statusCode).toBe(404);
    expect(errorCode(res)).toBe('workspace_not_found');
    expect((await call('GET', membersUrl(workspace.id), member)).statusCode).toBe(404);
  });
});
