import { LINE_SIDES, THREAD_STATUSES } from '@diffcraft/shared';
import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { reviewFiles, reviews } from './reviews.js';
import { sqlList } from './sql-list.js';
import { users } from './users.js';

export const commentThreads = pgTable(
  'comment_threads',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    reviewId: uuid('review_id')
      .notNull()
      .references(() => reviews.id, { onDelete: 'cascade' }),
    // The anchor: a line on one side of one file. All four columns are NULL for a review-level
    // thread, and all four are set for a line thread (comment_threads_anchor_check), so a
    // half-written anchor can't exist.
    fileId: uuid('file_id').references(() => reviewFiles.id, { onDelete: 'cascade' }),
    side: text('side', { enum: LINE_SIDES }),
    line: integer('line'),
    // The line's text when the thread was started.
    lineContent: text('line_content'),
    status: text('status', { enum: THREAD_STATUSES }).notNull().default('open'),
    resolvedBy: uuid('resolved_by').references(() => users.id, { onDelete: 'set null' }),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    // SET NULL: deleting an account must not delete discussions others took part in.
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    // Also serves as the index for the review_id foreign key.
    index('comment_threads_review_id_file_id_idx').on(table.reviewId, table.fileId),
    // For the file_id foreign key: deleting a review deletes its files, and each file's cascade
    // looks up threads by file_id alone, which the index above can't serve.
    index('comment_threads_file_id_idx').on(table.fileId),
    // For SET NULL when a user is deleted.
    index('comment_threads_created_by_idx').on(table.createdBy),
    index('comment_threads_resolved_by_idx').on(table.resolvedBy),
    check(
      'comment_threads_anchor_check',
      sql`num_nulls(${table.fileId}, ${table.side}, ${table.line}, ${table.lineContent}) in (0, 4)`,
    ),
    check('comment_threads_side_check', sql`${table.side} in (${sqlList(LINE_SIDES)})`),
    check('comment_threads_line_check', sql`${table.line} > 0`),
    check('comment_threads_status_check', sql`${table.status} in (${sqlList(THREAD_STATUSES)})`),
    // resolved_by is not part of this: it becomes NULL if the resolver's account is deleted.
    check(
      'comment_threads_resolved_check',
      sql`(${table.status} = 'resolved') = (${table.resolvedAt} is not null)`,
    ),
  ],
);

export const comments = pgTable(
  'comments',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    threadId: uuid('thread_id')
      .notNull()
      .references(() => commentThreads.id, { onDelete: 'cascade' }),
    authorId: uuid('author_id').references(() => users.id, { onDelete: 'set null' }),
    // Emptied when the comment is deleted; the row stays so the thread keeps its shape.
    body: text('body').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    // Also serves as the index for the thread_id foreign key.
    index('comments_thread_id_created_at_idx').on(table.threadId, table.createdAt),
    index('comments_author_id_idx').on(table.authorId),
  ],
);

export type CommentThreadRow = typeof commentThreads.$inferSelect;
export type CommentRow = typeof comments.$inferSelect;
