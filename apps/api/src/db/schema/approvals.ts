import { DECISIONS, REVIEW_EVENT_TYPES } from '@diffcraft/shared';
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { reviews } from './reviews.js';
import { sqlList } from './sql-list.js';
import { users } from './users.js';

export const reviewReviewers = pgTable(
  'review_reviewers',
  {
    reviewId: uuid('review_id')
      .notNull()
      .references(() => reviews.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    assignedBy: uuid('assigned_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.reviewId, table.userId] }),
    // The primary key starts with review_id, so "reviews waiting for me" needs its own index.
    index('review_reviewers_user_id_idx').on(table.userId),
    index('review_reviewers_assigned_by_idx').on(table.assignedBy),
  ],
);

// Append-only: a new decision is a new row, so the history stays and "latest per reviewer" is a query.
export const reviewDecisions = pgTable(
  'review_decisions',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    reviewId: uuid('review_id')
      .notNull()
      .references(() => reviews.id, { onDelete: 'cascade' }),
    reviewerId: uuid('reviewer_id').references(() => users.id, { onDelete: 'set null' }),
    decision: text('decision', { enum: DECISIONS }).notNull(),
    body: text('body'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('review_decisions_review_id_reviewer_id_created_at_idx').on(
      table.reviewId,
      table.reviewerId,
      table.createdAt.desc(),
    ),
    // For SET NULL when a user is deleted.
    index('review_decisions_reviewer_id_idx').on(table.reviewerId),
    check('review_decisions_decision_check', sql`${table.decision} in (${sqlList(DECISIONS)})`),
  ],
);

export const reviewEvents = pgTable(
  'review_events',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    reviewId: uuid('review_id')
      .notNull()
      .references(() => reviews.id, { onDelete: 'cascade' }),
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    type: text('type', { enum: REVIEW_EVENT_TYPES }).notNull(),
    data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('review_events_review_id_created_at_idx').on(table.reviewId, table.createdAt),
    index('review_events_actor_id_idx').on(table.actorId),
    check('review_events_type_check', sql`${table.type} in (${sqlList(REVIEW_EVENT_TYPES)})`),
  ],
);

export type ReviewDecisionRow = typeof reviewDecisions.$inferSelect;
export type ReviewEventRow = typeof reviewEvents.$inferSelect;
