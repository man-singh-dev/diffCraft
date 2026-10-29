import { randomInt } from 'node:crypto';
import type { CreateWorkspaceRequest, Workspace, WorkspaceRole } from '@diffcraft/shared';
import { and, desc, eq } from 'drizzle-orm';
import { isUniqueViolation } from '../../db/errors.js';
import { workspaceMembers, workspaces, type WorkspaceRow } from '../../db/schema/index.js';
import type { Database } from '../../plugins/db.js';

export const SLUG_MAX_LENGTH = 40;
const SLUG_UNIQUE_CONSTRAINT = 'workspaces_slug_unique';
const SLUG_SUFFIX_LENGTH = 4;
const SLUG_SUFFIX_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';
// One try with the plain slug, then a few with a random suffix: 36^4 suffixes make repeated
// collisions practically impossible, so running out means something else is wrong.
const MAX_SLUG_ATTEMPTS = 5;

/** URL-safe slug: lowercase ASCII letters, digits and single hyphens, at most 40 characters. */
export function slugify(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // drop accents, so "Café" becomes "cafe", not "caf"
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX_LENGTH)
    .replace(/-+$/, '');
  return slug || 'workspace';
}

function withRandomSuffix(slug: string): string {
  let suffix = '';
  for (let i = 0; i < SLUG_SUFFIX_LENGTH; i++) {
    suffix += SLUG_SUFFIX_CHARS[randomInt(SLUG_SUFFIX_CHARS.length)];
  }
  const base = slug.slice(0, SLUG_MAX_LENGTH - SLUG_SUFFIX_LENGTH - 1).replace(/-+$/, '');
  return `${base}-${suffix}`;
}

export function toWorkspace(row: WorkspaceRow, role: WorkspaceRole): Workspace {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    createdAt: row.createdAt.toISOString(),
    role,
  };
}

/** Creates a workspace with `userId` as its owner. `input` must already be validated. */
export async function createWorkspace(
  db: Database,
  userId: string,
  input: CreateWorkspaceRequest,
): Promise<Workspace> {
  const baseSlug = slugify(input.name);

  for (let attempt = 0; attempt < MAX_SLUG_ATTEMPTS; attempt++) {
    const slug = attempt === 0 ? baseSlug : withRandomSuffix(baseSlug);
    try {
      // A whole new transaction per attempt: after a failed statement Postgres aborts the
      // transaction, so it can't be retried inside the same one.
      return await db.transaction(async (tx) => {
        const [row] = await tx
          .insert(workspaces)
          .values({ name: input.name, slug, createdBy: userId })
          .returning();
        if (!row) throw new Error('INSERT ... RETURNING returned no row');
        await tx.insert(workspaceMembers).values({ workspaceId: row.id, userId, role: 'owner' });
        return toWorkspace(row, 'owner');
      });
    } catch (error) {
      if (!isUniqueViolation(error, SLUG_UNIQUE_CONSTRAINT)) throw error;
    }
  }
  throw new Error(`no free slug for "${baseSlug}" after ${MAX_SLUG_ATTEMPTS} attempts`);
}

/** The user's workspaces with their role in each, newest first. */
export async function listWorkspacesForUser(db: Database, userId: string): Promise<Workspace[]> {
  const rows = await db
    .select({ workspace: workspaces, role: workspaceMembers.role })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaceMembers.workspaceId, workspaces.id))
    .where(eq(workspaceMembers.userId, userId))
    // id breaks ties: uuidv7 ids are time-ordered too.
    .orderBy(desc(workspaces.createdAt), desc(workspaces.id));

  return rows.map(({ workspace, role }) => toWorkspace(workspace, role));
}

/** The user's role in the workspace, or null if they are not a member. */
export async function getMembership(
  db: Database,
  workspaceId: string,
  userId: string,
): Promise<WorkspaceRole | null> {
  const [row] = await db
    .select({ role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)));
  return row?.role ?? null;
}
