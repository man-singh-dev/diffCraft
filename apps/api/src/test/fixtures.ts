import { randomUUID } from 'node:crypto';
import type { WorkspaceRole } from '@diffcraft/shared';
import { users, workspaceMembers } from '../db/schema/index.js';
import { createSession, SESSION_COOKIE_NAME } from '../modules/auth/session.js';
import type { Database } from '../plugins/db.js';

type Table = Parameters<Database['insert']>[0];

export interface TestUser {
  id: string;
  email: string;
  cookies: Record<string, string>;
}

// Inserted directly with a unique email: test files share one database. Verified unless asked otherwise.
export async function createUserWithSession(
  db: Database,
  { verified = true }: { verified?: boolean } = {},
): Promise<TestUser> {
  const email = `user-${randomUUID()}@example.com`;
  const [user] = await db
    .insert(users)
    .values({
      email,
      displayName: 'Test',
      passwordHash: 'not-a-real-hash',
      emailVerifiedAt: verified ? new Date() : null,
    })
    .returning({ id: users.id });
  if (!user) throw new Error('no user returned');
  const { token } = await createSession(db, user.id);
  return { id: user.id, email, cookies: { [SESSION_COOKIE_NAME]: token } };
}

export async function addMember(
  db: Database,
  workspaceId: string,
  userId: string,
  role: WorkspaceRole,
): Promise<void> {
  await db.insert(workspaceMembers).values({ workspaceId, userId, role });
}

// Earlier statements in the transaction really run, so a test can check they were rolled back.
export function failInsertInTransaction(db: Database, table: Table, message: string): Database {
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
                  return (insertTable: Table) => {
                    if (insertTable === table) throw new Error(message);
                    return txTarget.insert(insertTable);
                  };
                },
              }),
            ),
          config,
        )) as Database['transaction'];
    },
  });
}
