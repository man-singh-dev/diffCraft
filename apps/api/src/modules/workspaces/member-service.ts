import {
  type AddMemberRequest,
  canManageMember,
  type WorkspaceMember,
  type WorkspaceRole,
} from '@diffcraft/shared';
import { and, asc, count, desc, eq, sql } from 'drizzle-orm';
import { isUniqueViolation } from '../../db/errors.js';
import { users, workspaceMembers, workspaces } from '../../db/schema/index.js';
import { AppError, ForbiddenError, NotFoundError } from '../../errors.js';
import type { Database } from '../../plugins/db.js';
import { WorkspaceNotFoundError } from './require-workspace-role.js';

const MEMBERSHIP_PRIMARY_KEY = 'workspace_members_workspace_id_user_id_pk';

export class MemberNotFoundError extends NotFoundError {
  constructor() {
    super('member_not_found', 'Member not found.');
  }
}

export class UserNotFoundError extends NotFoundError {
  constructor() {
    super('user_not_found', 'No user with this email.');
  }
}

export class AlreadyMemberError extends AppError {
  constructor() {
    super(409, 'already_member', 'This user is already a member of the workspace.');
  }
}

export class LastOwnerError extends AppError {
  constructor() {
    super(409, 'last_owner', 'A workspace must keep at least one owner.');
  }
}

export class CannotRemoveSelfError extends AppError {
  constructor() {
    super(400, 'cannot_remove_self', 'To leave the workspace, use POST /members/leave.');
  }
}

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

const memberColumns = {
  userId: workspaceMembers.userId,
  email: users.email,
  displayName: users.displayName,
  role: workspaceMembers.role,
  joinedAt: workspaceMembers.joinedAt,
};

function toMember(row: { joinedAt: Date } & Omit<WorkspaceMember, 'joinedAt'>): WorkspaceMember {
  return { ...row, joinedAt: row.joinedAt.toISOString() };
}

/** canManageMember as a 403; `nextRole` is undefined for a removal. */
export function assertCanManage(
  actorRole: WorkspaceRole,
  targetRole: WorkspaceRole | null,
  nextRole?: WorkspaceRole,
): void {
  if (!canManageMember(actorRole, targetRole, nextRole)) throw new ForbiddenError();
}

/** Members of the workspace: owners first, then by join date. */
export async function listMembers(db: Database, workspaceId: string): Promise<WorkspaceMember[]> {
  const rows = await db
    .select(memberColumns)
    .from(workspaceMembers)
    .innerJoin(users, eq(workspaceMembers.userId, users.id))
    .where(eq(workspaceMembers.workspaceId, workspaceId))
    .orderBy(
      desc(sql`${workspaceMembers.role} = 'owner'`),
      asc(workspaceMembers.joinedAt),
      asc(workspaceMembers.userId),
    );
  return rows.map(toMember);
}

async function findMember(
  tx: Tx,
  workspaceId: string,
  userId: string,
): Promise<WorkspaceMember | null> {
  const [row] = await tx
    .select(memberColumns)
    .from(workspaceMembers)
    .innerJoin(users, eq(workspaceMembers.userId, users.id))
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)));
  return row ? toMember(row) : null;
}

async function countOwners(tx: Tx, workspaceId: string): Promise<number> {
  const [row] = await tx
    .select({ owners: count() })
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.role, 'owner')));
  return row?.owners ?? 0;
}

/**
 * Runs `change` in a transaction that holds the workspace row lock, with the actor's role
 * re-read under that lock.
 *
 * Why the lock: "count owners, then demote/remove one" is check-then-act. Under READ COMMITTED,
 * two owners demoting each other at once would each see 2 owners, update different rows (so
 * no row conflict), and leave the workspace with none. Every membership change locks the same
 * workspace row first, so they run one at a time and each sees the previous one's result.
 * The role from requireWorkspaceRole is re-read for the same reason: it may have just changed.
 */
async function withWorkspaceLock<T>(
  db: Database,
  workspaceId: string,
  actorId: string,
  change: (tx: Tx, actor: WorkspaceMember) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    const [workspace] = await tx
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId))
      .for('update');
    if (!workspace) throw new WorkspaceNotFoundError();

    const actor = await findMember(tx, workspaceId, actorId);
    if (!actor) throw new WorkspaceNotFoundError();
    return change(tx, actor);
  });
}

/** Adds an existing user by email. `input` must already be validated (email lowercased). */
export async function addMember(
  db: Database,
  workspaceId: string,
  actorId: string,
  input: AddMemberRequest,
): Promise<WorkspaceMember> {
  return withWorkspaceLock(db, workspaceId, actorId, async (tx, actor) => {
    assertCanManage(actor.role, null, input.role);

    const [user] = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(sql`lower(${users.email})`, input.email));
    if (!user) throw new UserNotFoundError();

    try {
      await tx.insert(workspaceMembers).values({ workspaceId, userId: user.id, role: input.role });
    } catch (error) {
      if (isUniqueViolation(error, MEMBERSHIP_PRIMARY_KEY)) throw new AlreadyMemberError();
      throw error;
    }
    const member = await findMember(tx, workspaceId, user.id);
    if (!member) throw new Error('membership missing right after insert');
    return member;
  });
}

export async function changeMemberRole(
  db: Database,
  workspaceId: string,
  actorId: string,
  targetId: string,
  role: WorkspaceRole,
): Promise<WorkspaceMember> {
  return withWorkspaceLock(db, workspaceId, actorId, async (tx, actor) => {
    const target = await findMember(tx, workspaceId, targetId);
    if (!target) throw new MemberNotFoundError();
    assertCanManage(actor.role, target.role, role);
    if (target.role === role) return target;

    if (target.role === 'owner' && (await countOwners(tx, workspaceId)) <= 1) {
      throw new LastOwnerError();
    }
    await tx
      .update(workspaceMembers)
      .set({ role })
      .where(
        and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, targetId)),
      );
    return { ...target, role };
  });
}

/** Removes another member; the caller leaves with leaveWorkspace instead. */
export async function removeMember(
  db: Database,
  workspaceId: string,
  actorId: string,
  targetId: string,
): Promise<void> {
  if (targetId === actorId) throw new CannotRemoveSelfError();
  await withWorkspaceLock(db, workspaceId, actorId, async (tx, actor) => {
    const target = await findMember(tx, workspaceId, targetId);
    if (!target) throw new MemberNotFoundError();
    assertCanManage(actor.role, target.role);
    await deleteMembership(tx, workspaceId, target);
  });
}

/** Any member may leave, except the last owner. */
export async function leaveWorkspace(
  db: Database,
  workspaceId: string,
  actorId: string,
): Promise<void> {
  await withWorkspaceLock(db, workspaceId, actorId, (tx, actor) =>
    deleteMembership(tx, workspaceId, actor),
  );
}

async function deleteMembership(tx: Tx, workspaceId: string, member: WorkspaceMember) {
  if (member.role === 'owner' && (await countOwners(tx, workspaceId)) <= 1) {
    throw new LastOwnerError();
  }
  await tx
    .delete(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.userId, member.userId),
      ),
    );
}
