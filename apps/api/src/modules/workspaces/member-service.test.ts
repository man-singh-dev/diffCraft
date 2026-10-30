import { WORKSPACE_ROLES, type WorkspaceRole } from '@diffcraft/shared';
import { describe, expect, it } from 'vitest';
import { ForbiddenError } from '../../errors.js';
import { assertCanManage } from './member-service.js';

const allowed = (actor: WorkspaceRole, target: WorkspaceRole | null, next?: WorkspaceRole) => {
  try {
    assertCanManage(actor, target, next);
    return true;
  } catch (error) {
    expect(error).toBeInstanceOf(ForbiddenError);
    return false;
  }
};

describe('assertCanManage', () => {
  const nonOwners: WorkspaceRole[] = ['admin', 'member', 'viewer'];

  it('lets an owner do anything', () => {
    for (const target of [null, ...WORKSPACE_ROLES]) {
      for (const next of [undefined, ...WORKSPACE_ROLES]) {
        expect(allowed('owner', target, next), `${target} → ${next}`).toBe(true);
      }
    }
  });

  it('lets an admin manage only admins, members and viewers', () => {
    for (const target of [null, ...nonOwners]) {
      for (const next of [undefined, ...nonOwners]) {
        expect(allowed('admin', target, next), `${target} → ${next}`).toBe(true);
      }
      expect(allowed('admin', target, 'owner'), `${target} → owner`).toBe(false);
    }
    for (const next of [undefined, ...WORKSPACE_ROLES]) {
      expect(allowed('admin', 'owner', next), `owner → ${next}`).toBe(false);
    }
  });

  it('refuses members and viewers', () => {
    for (const actor of ['member', 'viewer'] as const) {
      expect(allowed(actor, 'viewer', 'viewer')).toBe(false);
      expect(allowed(actor, null, 'viewer')).toBe(false);
      expect(allowed(actor, 'viewer')).toBe(false);
    }
  });
});
