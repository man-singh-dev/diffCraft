import { randomUUID } from 'node:crypto';
import type { WorkspaceRole } from '@diffcraft/shared';
import { users, workspaceMembers } from '../db/schema/index.js';
import { createSession, SESSION_COOKIE_NAME } from '../modules/auth/session.js';
import type { Database } from '../plugins/db.js';

export interface TestUser {
  id: string;
  /** Pass as `cookies` to app.inject() to call the API as this user. */
  cookies: Record<string, string>;
}

// Inserted directly (no Argon2, no HTTP) and with a unique email: test files share one database.
export async function createUserWithSession(db: Database): Promise<TestUser> {
  const [user] = await db
    .insert(users)
    .values({
      email: `user-${randomUUID()}@example.com`,
      displayName: 'Test',
      passwordHash: 'not-a-real-hash',
    })
    .returning({ id: users.id });
  if (!user) throw new Error('no user returned');
  const { token } = await createSession(db, user.id);
  return { id: user.id, cookies: { [SESSION_COOKIE_NAME]: token } };
}

export async function addMember(
  db: Database,
  workspaceId: string,
  userId: string,
  role: WorkspaceRole,
): Promise<void> {
  await db.insert(workspaceMembers).values({ workspaceId, userId, role });
}
