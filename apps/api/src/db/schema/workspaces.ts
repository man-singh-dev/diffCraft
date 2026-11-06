import { MAX_REQUIRED_APPROVALS, WORKSPACE_ROLES } from '@diffcraft/shared';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { sqlList } from './sql-list.js';
import { users } from './users.js';

export const workspaces = pgTable(
  'workspaces',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    name: text('name').notNull(),
    slug: text('slug').notNull().unique('workspaces_slug_unique'),
    // SET NULL, not CASCADE: deleting the creator's account must not delete a shared workspace.
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    // Incremented with UPDATE … RETURNING, whose row lock gives concurrent creates distinct numbers (max + 1 would race).
    lastReviewNumber: integer('last_review_number').notNull().default(0),
    requiredApprovals: integer('required_approvals').notNull().default(1),
    requireResolvedThreads: boolean('require_resolved_threads').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    check(
      'workspaces_required_approvals_check',
      sql`${table.requiredApprovals} between 0 and ${sql.raw(String(MAX_REQUIRED_APPROVALS))}`,
    ),
  ],
);

export const workspaceMembers = pgTable(
  'workspace_members',
  {
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role', { enum: WORKSPACE_ROLES }).notNull(),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.userId] }),
    // The primary key starts with workspace_id, so "my workspaces" needs its own index.
    index('workspace_members_user_id_idx').on(table.userId),
    check('workspace_members_role_check', sql`${table.role} in (${sqlList(WORKSPACE_ROLES)})`),
  ],
);

export type WorkspaceRow = typeof workspaces.$inferSelect;
export type WorkspaceMember = typeof workspaceMembers.$inferSelect;
