import { NOTIFICATION_TYPES } from '@diffcraft/shared';
import { sql } from 'drizzle-orm';
import { check, index, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { commentThreads } from './comments.js';
import { reviews } from './reviews.js';
import { sqlList } from './sql-list.js';
import { users } from './users.js';
import { workspaces } from './workspaces.js';

// Ids and a type only: what a notification says is rendered from current data, so no comment text is copied here.
export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    reviewId: uuid('review_id')
      .notNull()
      .references(() => reviews.id, { onDelete: 'cascade' }),
    threadId: uuid('thread_id').references(() => commentThreads.id, { onDelete: 'cascade' }),
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    type: text('type', { enum: NOTIFICATION_TYPES }).notNull(),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('notifications_user_id_created_at_id_idx').on(
      table.userId,
      table.createdAt.desc(),
      table.id.desc(),
    ),
    index('notifications_user_id_unread_idx')
      .on(table.userId)
      .where(sql`${table.readAt} is null`),
    // For the foreign keys: deleting a workspace, review, thread or actor looks rows up by these columns.
    index('notifications_workspace_id_idx').on(table.workspaceId),
    index('notifications_review_id_idx').on(table.reviewId),
    index('notifications_thread_id_idx').on(table.threadId),
    index('notifications_actor_id_idx').on(table.actorId),
    check('notifications_type_check', sql`${table.type} in (${sqlList(NOTIFICATION_TYPES)})`),
  ],
);

export const outboxEvents = pgTable(
  'outbox_events',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    topic: text('topic').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    attempts: integer('attempts').notNull().default(0),
  },
  (table) => [
    index('outbox_events_unpublished_idx')
      .on(table.id)
      .where(sql`${table.publishedAt} is null`),
  ],
);

export type NotificationRow = typeof notifications.$inferSelect;
export type OutboxEventRow = typeof outboxEvents.$inferSelect;
