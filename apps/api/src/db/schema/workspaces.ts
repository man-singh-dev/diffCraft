import { WORKSPACE_ROLES } from '@diffcraft/shared';
import { sql } from 'drizzle-orm';
import {
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

export const workspaces = pgTable('workspaces', {
  id: uuid('id')
    .primaryKey()
    .default(sql`uuidv7()`),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique('workspaces_slug_unique'),
  // SET NULL, not CASCADE: deleting the creator's account must not delete a shared workspace.
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  // Hands out review numbers. Incremented with UPDATE … RETURNING, which locks the row, so
  // concurrent creates get distinct numbers (SELECT max(number) + 1 would race).
  lastReviewNumber: integer('last_review_number').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

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
