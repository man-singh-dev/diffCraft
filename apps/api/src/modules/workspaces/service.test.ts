import { randomUUID } from 'node:crypto';
import type { WorkspaceRole } from '@diffcraft/shared';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';
import { users, workspaceMembers, workspaces } from '../../db/schema/index.js';
import type { Database } from '../../plugins/db.js';
import { describeWithDb, testDatabaseUrl } from '../../test/db.js';
import {
  createWorkspace,
  getMembership,
  listWorkspacesForUser,
  SLUG_MAX_LENGTH,
  slugify,
} from './service.js';

const UNIQUE_VIOLATION = '23505';
const CHECK_VIOLATION = '23514';

describe('slugify', () => {
  it('lowercases and turns other characters into single hyphens', () => {
    expect(slugify('My Team!')).toBe('my-team');
    expect(slugify('  Front -- End & API  ')).toBe('front-end-api');
  });

  it('drops accents instead of the letters', () => {
    expect(slugify('Café Crème')).toBe('cafe-creme');
  });

  it('falls back to "workspace" when nothing is left', () => {
    expect(slugify('!!! ???')).toBe('workspace');
    expect(slugify('日本語')).toBe('workspace');
  });

  it('cuts long names to 40 characters without a trailing hyphen', () => {
    expect(slugify('a'.repeat(100))).toBe('a'.repeat(SLUG_MAX_LENGTH));
    // Character 40 is a hyphen here, so the cut must drop it.
    expect(slugify(`${'a'.repeat(39)} bbb`)).toBe('a'.repeat(39));
  });
});

/** Wraps `db` so that, inside a transaction, inserting a membership throws. */
function failMembershipInsert(db: Database): Database {
  const passThrough = <T extends object>(target: T, prop: string | symbol): unknown => {
    const value: unknown = Reflect.get(target, prop);
    return typeof value === 'function' ? value.bind(target) : value;
  };
  return new Proxy(db, {
    get(target, prop) {
      if (prop !== 'transaction') return passThrough(target, prop);
      return ((run, config) =>
        target.transaction(
          (tx) =>
            run(
              new Proxy(tx, {
                get(txTarget, txProp) {
                  if (txProp !== 'insert') return passThrough(txTarget, txProp);
                  return (table: unknown) => {
                    if (table === workspaceMembers) throw new Error('forced membership failure');
                    return txTarget.insert(table as typeof workspaces);
                  };
                },
              }),
            ),
          config,
        )) as Database['transaction'];
    },
  });
}

describeWithDb('workspaces service and tables', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp(loadConfig({ LOG_LEVEL: 'silent', DATABASE_URL: testDatabaseUrl }));
  });

  afterAll(async () => {
    await app.close();
  });

  async function createUser(): Promise<string> {
    const [user] = await app.db
      .insert(users)
      .values({
        email: `${randomUUID()}@example.com`,
        displayName: 'Test',
        passwordHash: 'not-a-real-hash',
      })
      .returning({ id: users.id });
    if (!user) throw new Error('no user returned');
    return user.id;
  }

  /** A workspace name no other test (or earlier run) has used. */
  const uniqueName = () => `Team ${randomUUID()}`;

  it('creates the workspace and the creator as its owner', async () => {
    const userId = await createUser();
    const name = uniqueName();

    const workspace = await createWorkspace(app.db, userId, { name });

    expect(workspace).toMatchObject({ name, slug: slugify(name), role: 'owner' });
    const [row] = await app.db.select().from(workspaces).where(eq(workspaces.id, workspace.id));
    expect(row?.createdBy).toBe(userId);
    await expect(getMembership(app.db, workspace.id, userId)).resolves.toBe('owner');
  });

  it('gives two workspaces with the same name different slugs', async () => {
    const userId = await createUser();
    const name = uniqueName();

    const first = await createWorkspace(app.db, userId, { name });
    const second = await createWorkspace(app.db, userId, { name });

    expect(first.slug).toBe(slugify(name));
    expect(second.slug).not.toBe(first.slug);
    expect(second.slug).toMatch(/-[a-z0-9]{4}$/);
    expect(second.slug.length).toBeLessThanOrEqual(SLUG_MAX_LENGTH);
  });

  it('leaves no workspace behind when the membership insert fails', async () => {
    const userId = await createUser();
    const name = uniqueName();

    await expect(createWorkspace(failMembershipInsert(app.db), userId, { name })).rejects.toThrow(
      'forced membership failure',
    );

    const rows = await app.db.select().from(workspaces).where(eq(workspaces.name, name));
    expect(rows).toEqual([]);
  });

  it('rejects adding the same user to the same workspace twice', async () => {
    const userId = await createUser();
    const workspace = await createWorkspace(app.db, userId, { name: uniqueName() });

    await expect(
      app.db.insert(workspaceMembers).values({ workspaceId: workspace.id, userId, role: 'member' }),
    ).rejects.toMatchObject({
      cause: { code: UNIQUE_VIOLATION, constraint: 'workspace_members_workspace_id_user_id_pk' },
    });
  });

  it('rejects a role outside the four allowed ones', async () => {
    const ownerId = await createUser();
    const otherId = await createUser();
    const workspace = await createWorkspace(app.db, ownerId, { name: uniqueName() });

    await expect(
      app.db.insert(workspaceMembers).values({
        workspaceId: workspace.id,
        userId: otherId,
        role: 'superadmin' as WorkspaceRole,
      }),
    ).rejects.toMatchObject({
      cause: { code: CHECK_VIOLATION, constraint: 'workspace_members_role_check' },
    });
  });

  it('deletes the memberships when the workspace is deleted', async () => {
    const userId = await createUser();
    const workspace = await createWorkspace(app.db, userId, { name: uniqueName() });

    await app.db.delete(workspaces).where(eq(workspaces.id, workspace.id));

    const members = await app.db
      .select()
      .from(workspaceMembers)
      .where(eq(workspaceMembers.workspaceId, workspace.id));
    expect(members).toEqual([]);
  });

  it('keeps the workspace with created_by = null when the creator is deleted', async () => {
    const creatorId = await createUser();
    const workspace = await createWorkspace(app.db, creatorId, { name: uniqueName() });

    await app.db.delete(users).where(eq(users.id, creatorId));

    const [row] = await app.db.select().from(workspaces).where(eq(workspaces.id, workspace.id));
    expect(row).toBeDefined();
    expect(row?.createdBy).toBeNull();
    await expect(getMembership(app.db, workspace.id, creatorId)).resolves.toBeNull();
  });

  it("lists only the user's workspaces, newest first, with their role in each", async () => {
    const alice = await createUser();
    const bob = await createUser();
    const older = await createWorkspace(app.db, alice, { name: uniqueName() });
    const newer = await createWorkspace(app.db, alice, { name: uniqueName() });
    const bobsOwn = await createWorkspace(app.db, bob, { name: uniqueName() });
    await app.db
      .insert(workspaceMembers)
      .values({ workspaceId: bobsOwn.id, userId: alice, role: 'viewer' });

    const aliceList = await listWorkspacesForUser(app.db, alice);
    expect(aliceList.map((w) => [w.id, w.role])).toEqual([
      [bobsOwn.id, 'viewer'],
      [newer.id, 'owner'],
      [older.id, 'owner'],
    ]);

    const bobList = await listWorkspacesForUser(app.db, bob);
    expect(bobList.map((w) => [w.id, w.role])).toEqual([[bobsOwn.id, 'owner']]);
  });

  it('returns null from getMembership for a non-member', async () => {
    const ownerId = await createUser();
    const strangerId = await createUser();
    const workspace = await createWorkspace(app.db, ownerId, { name: uniqueName() });

    await expect(getMembership(app.db, workspace.id, strangerId)).resolves.toBeNull();
  });
});
