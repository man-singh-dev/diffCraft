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
    // "#12" for people and URLs, from workspaces.last_review_number.
    number: integer('number').notNull(),
    // SET NULL: deleting an account must not delete reviews others have worked on.
    authorId: uuid('author_id').references(() => users.id, { onDelete: 'set null' }),
    title: text('title').notNull(),
    description: text('description'),
    status: text('status', { enum: REVIEW_STATUSES }).notNull().default('open'),
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
    // Also serves as the index for the workspace_id foreign key.
    unique('reviews_workspace_id_number_unique').on(table.workspaceId, table.number),
    // Newest first with a (created_at, id) cursor.
    index('reviews_workspace_id_created_at_id_idx').on(
      table.workspaceId,
      table.createdAt.desc(),
      table.id.desc(),
    ),
    index('reviews_author_id_idx').on(table.authorId),
    check('reviews_status_check', sql`${table.status} in (${sqlList(REVIEW_STATUSES)})`),
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
    // jsonb rather than hunk and line tables: a file's hunks are always read whole and never
    // queried into, and up to 20,000 line rows per review would buy nothing.
    hunks: jsonb('hunks').$type<DiffHunk[]>().notNull(),
  },
  (table) => [
    // Also serves as the index for the review_id foreign key.
    unique('review_files_review_id_position_unique').on(table.reviewId, table.position),
    check(
      'review_files_change_type_check',
      sql`${table.changeType} in (${sqlList(DIFF_CHANGE_TYPES)})`,
    ),
  ],
);

export type ReviewRow = typeof reviews.$inferSelect;
export type ReviewFileRow = typeof reviewFiles.$inferSelect;
