import { describe, expect, it } from 'vitest';
import {
  CreateWorkspaceRequestSchema,
  hasAtLeastRole,
  UpdateWorkspaceRequestSchema,
  WORKSPACE_ROLES,
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
