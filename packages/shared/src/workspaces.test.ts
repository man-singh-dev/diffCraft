import { describe, expect, it } from 'vitest';
import {
  AddMemberRequestSchema,
  canManageMember,
  CreateWorkspaceRequestSchema,
  hasAtLeastRole,
  UpdateMemberRoleRequestSchema,
  UpdateWorkspaceRequestSchema,
  WORKSPACE_ROLES,
  WorkspaceMemberSchema,
  type WorkspaceRole,
  WorkspaceRoleSchema,
  WorkspaceSchema,
} from './workspaces.js';

describe('hasAtLeastRole', () => {
  const order: WorkspaceRole[] = ['viewer', 'member', 'admin', 'owner'];

  it('ranks viewer < member < admin < owner', () => {
    for (const [i, role] of order.entries()) {
      for (const [j, minimum] of order.entries()) {
        expect(hasAtLeastRole(role, minimum), `${role} >= ${minimum}`).toBe(i >= j);
      }
    }
  });

  it('covers every role', () => {
    expect([...order].sort()).toEqual([...WORKSPACE_ROLES].sort());
  });
});

describe('UpdateWorkspaceRequestSchema', () => {
  it('trims the name and enforces length 1–80', () => {
    expect(UpdateWorkspaceRequestSchema.parse({ name: '  New  ' })).toEqual({ name: 'New' });
    expect(UpdateWorkspaceRequestSchema.safeParse({ name: '  ' }).success).toBe(false);
    expect(UpdateWorkspaceRequestSchema.safeParse({ name: 'a'.repeat(81) }).success).toBe(false);
    expect(UpdateWorkspaceRequestSchema.safeParse({}).success).toBe(false);
  });
});

describe('WorkspaceRoleSchema', () => {
  it('accepts the four roles', () => {
    for (const role of ['owner', 'admin', 'member', 'viewer']) {
      expect(WorkspaceRoleSchema.parse(role)).toBe(role);
    }
  });

  it('rejects anything else', () => {
    expect(WorkspaceRoleSchema.safeParse('superadmin').success).toBe(false);
    expect(WorkspaceRoleSchema.safeParse('Owner').success).toBe(false);
  });
});

describe('CreateWorkspaceRequestSchema', () => {
  it('trims the name', () => {
    expect(CreateWorkspaceRequestSchema.parse({ name: '  My Team  ' })).toEqual({
      name: 'My Team',
    });
  });

  it('enforces name length 1–80 after trimming', () => {
    const withName = (name: string) => CreateWorkspaceRequestSchema.safeParse({ name }).success;
    expect(withName('   ')).toBe(false);
    expect(withName('a')).toBe(true);
    expect(withName('a'.repeat(80))).toBe(true);
    expect(withName('a'.repeat(81))).toBe(false);
  });

  it('rejects a missing name', () => {
    expect(CreateWorkspaceRequestSchema.safeParse({}).success).toBe(false);
  });
});

describe('WorkspaceSchema', () => {
  const validWorkspace = {
    id: '0199f3a4-5b6c-7d8e-9f01-23456789abcd',
    name: 'My Team',
    slug: 'my-team',
    createdAt: '2026-10-30T10:00:00.000Z',
    role: 'owner',
  };

  it('parses a valid workspace', () => {
    expect(WorkspaceSchema.parse(validWorkspace)).toEqual(validWorkspace);
  });

  it('rejects an unknown role and a non-ISO createdAt', () => {
    expect(WorkspaceSchema.safeParse({ ...validWorkspace, role: 'superadmin' }).success).toBe(
      false,
    );
    expect(WorkspaceSchema.safeParse({ ...validWorkspace, createdAt: 'today' }).success).toBe(
      false,
    );
  });
});

describe('AddMemberRequestSchema', () => {
  it('trims and lowercases the email', () => {
    expect(AddMemberRequestSchema.parse({ email: '  Ann@Example.COM ', role: 'member' })).toEqual({
      email: 'ann@example.com',
      role: 'member',
    });
  });

  it('rejects an invalid email, an unknown role and missing fields', () => {
    const valid = { email: 'ann@example.com', role: 'viewer' };
    expect(AddMemberRequestSchema.safeParse({ ...valid, email: 'not-an-email' }).success).toBe(
      false,
    );
    expect(AddMemberRequestSchema.safeParse({ ...valid, role: 'superadmin' }).success).toBe(false);
    expect(AddMemberRequestSchema.safeParse({ email: valid.email }).success).toBe(false);
    expect(AddMemberRequestSchema.safeParse({ role: valid.role }).success).toBe(false);
  });
});

describe('UpdateMemberRoleRequestSchema', () => {
  it('accepts a role and rejects anything else', () => {
    expect(UpdateMemberRoleRequestSchema.parse({ role: 'admin' })).toEqual({ role: 'admin' });
    expect(UpdateMemberRoleRequestSchema.safeParse({ role: 'Admin' }).success).toBe(false);
    expect(UpdateMemberRoleRequestSchema.safeParse({}).success).toBe(false);
  });
});

describe('WorkspaceMemberSchema', () => {
  const validMember = {
    userId: '0199f3a4-5b6c-7d8e-9f01-23456789abcd',
    email: 'ann@example.com',
    displayName: 'Ann',
    role: 'admin',
    joinedAt: '2026-10-30T10:00:00.000Z',
  };

  it('parses a valid member', () => {
    expect(WorkspaceMemberSchema.parse(validMember)).toEqual(validMember);
  });

  it('rejects a non-UUID userId, an unknown role and a non-ISO joinedAt', () => {
    for (const override of [{ userId: 'abc' }, { role: 'superadmin' }, { joinedAt: 'today' }]) {
      expect(WorkspaceMemberSchema.safeParse({ ...validMember, ...override }).success).toBe(false);
    }
  });
});

describe('canManageMember', () => {
  const nonOwners: WorkspaceRole[] = ['admin', 'member', 'viewer'];

  it('lets an owner add, change and remove anyone, to and from any role', () => {
    for (const target of [null, ...WORKSPACE_ROLES]) {
      for (const next of [undefined, ...WORKSPACE_ROLES]) {
        expect(canManageMember('owner', target, next), `${target} → ${next}`).toBe(true);
      }
    }
  });

  it('lets an admin manage admins, members and viewers, but never grant owner', () => {
    for (const target of [null, ...nonOwners]) {
      for (const next of [undefined, ...nonOwners]) {
        expect(canManageMember('admin', target, next), `${target} → ${next}`).toBe(true);
      }
      expect(canManageMember('admin', target, 'owner'), `${target} → owner`).toBe(false);
    }
  });

  it('does not let an admin change or remove an owner', () => {
    for (const next of [undefined, ...WORKSPACE_ROLES]) {
      expect(canManageMember('admin', 'owner', next), `owner → ${next}`).toBe(false);
    }
  });

  it('never lets a member or viewer manage anyone', () => {
    for (const actor of ['member', 'viewer'] as const) {
      for (const target of [null, ...WORKSPACE_ROLES]) {
        for (const next of [undefined, ...WORKSPACE_ROLES]) {
          expect(canManageMember(actor, target, next), `${actor}: ${target} → ${next}`).toBe(false);
        }
      }
    }
  });
});
