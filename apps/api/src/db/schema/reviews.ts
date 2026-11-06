import { DIFF_CHANGE_TYPES, REVIEW_STATUSES, type DiffHunk } from '@diffcraft/shared';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { sqlList } from './sql-list.js';
import { users } from './users.js';
import { workspaces } from './workspaces.js';

export const reviews = pgTable(
  'reviews',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    number: integer('number').notNull(),
    // SET NULL: deleting an account must not delete reviews others have worked on.
    authorId: uuid('author_id').references(() => users.id, { onDelete: 'set null' }),
    title: text('title').notNull(),
    description: text('description'),
    status: text('status', { enum: REVIEW_STATUSES }).notNull().default('open'),
    mergedBy: uuid('merged_by').references(() => users.id, { onDelete: 'set null' }),
    mergedAt: timestamp('merged_at', { withTimezone: true }),
    // The raw upload, so it can be re-parsed if the parser or the stored shape changes.
    patch: text('patch').notNull(),
    // Stored so lists don't need to read review_files.
    filesChanged: integer('files_changed').notNull(),
    additions: integer('additions').notNull(),
    deletions: integer('deletions').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    unique('reviews_workspace_id_number_unique').on(table.workspaceId, table.number),
    index('reviews_workspace_id_created_at_id_idx').on(
      table.workspaceId,
      table.createdAt.desc(),
      table.id.desc(),
    ),
    index('reviews_author_id_idx').on(table.authorId),
    index('reviews_merged_by_idx').on(table.mergedBy),
    check('reviews_status_check', sql`${table.status} in (${sqlList(REVIEW_STATUSES)})`),
    // merged_by is not part of this: it becomes NULL if the merger's account is deleted.
    check(
      'reviews_merged_check',
      sql`(${table.status} = 'merged') = (${table.mergedAt} is not null)`,
    ),
  ],
);

export const reviewFiles = pgTable(
  'review_files',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    reviewId: uuid('review_id')
      .notNull()
      .references(() => reviews.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    oldPath: text('old_path'),
    newPath: text('new_path'),
    changeType: text('change_type', { enum: DIFF_CHANGE_TYPES }).notNull(),
    isBinary: boolean('is_binary').notNull(),
    additions: integer('additions').notNull(),
    deletions: integer('deletions').notNull(),
    // jsonb, not hunk/line tables: a file's hunks are always read whole and never queried into.
    hunks: jsonb('hunks').$type<DiffHunk[]>().notNull(),
  },
  (table) => [
    unique('review_files_review_id_position_unique').on(table.reviewId, table.position),
    check(
      'review_files_change_type_check',
      sql`${table.changeType} in (${sqlList(DIFF_CHANGE_TYPES)})`,
    ),
  ],
);

export type ReviewRow = typeof reviews.$inferSelect;
export type ReviewFileRow = typeof reviewFiles.$inferSelect;
