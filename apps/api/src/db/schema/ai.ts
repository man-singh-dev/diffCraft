import {
  AI_FINDING_CATEGORIES,
  AI_FINDING_SEVERITIES,
  AI_JOB_STATUSES,
  DIFF_SIDES,
} from '@diffcraft/shared';
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { reviewFiles, reviews } from './reviews.js';
import { sqlList } from './sql-list.js';
import { users } from './users.js';
import { workspaces } from './workspaces.js';

export const aiAnalysisJobs = pgTable(
  'ai_analysis_jobs',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    reviewId: uuid('review_id')
      .notNull()
      .references(() => reviews.id, { onDelete: 'cascade' }),
    requestedBy: uuid('requested_by').references(() => users.id, { onDelete: 'set null' }),
    status: text('status', { enum: AI_JOB_STATUSES }).notNull().default('queued'),
    idempotencyKey: text('idempotency_key').notNull(),
    promptVersion: text('prompt_version').notNull(),
    model: text('model').notNull(),
    attempts: integer('attempts').notNull().default(0),
    errorCode: text('error_code'),
    summary: text('summary'),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    droppedFindings: integer('dropped_findings').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (table) => [
    // Partial: finished jobs keep their key, so the same review can be analyzed again later.
    uniqueIndex('ai_analysis_jobs_active_idempotency_key_unique')
      .on(table.idempotencyKey)
      .where(sql`${table.status} in ('queued', 'running')`),
    index('ai_analysis_jobs_review_id_created_at_idx').on(table.reviewId, table.createdAt.desc()),
    index('ai_analysis_jobs_workspace_id_created_at_idx').on(table.workspaceId, table.createdAt),
    index('ai_analysis_jobs_requested_by_idx').on(table.requestedBy),
    index('ai_analysis_jobs_status_idx')
      .on(table.status)
      .where(sql`${table.status} in ('queued', 'running')`),
    check('ai_analysis_jobs_status_check', sql`${table.status} in (${sqlList(AI_JOB_STATUSES)})`),
  ],
);

export const aiFindings = pgTable(
  'ai_findings',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    jobId: uuid('job_id')
      .notNull()
      .references(() => aiAnalysisJobs.id, { onDelete: 'cascade' }),
    reviewId: uuid('review_id')
      .notNull()
      .references(() => reviews.id, { onDelete: 'cascade' }),
    reviewFileId: uuid('review_file_id').references(() => reviewFiles.id, { onDelete: 'cascade' }),
    side: text('side', { enum: DIFF_SIDES }),
    lineStart: integer('line_start'),
    lineEnd: integer('line_end'),
    category: text('category', { enum: AI_FINDING_CATEGORIES }).notNull(),
    severity: text('severity', { enum: AI_FINDING_SEVERITIES }).notNull(),
    title: text('title').notNull(),
    explanation: text('explanation').notNull(),
    suggestion: text('suggestion'),
    confidence: real('confidence').notNull(),
    dismissedAt: timestamp('dismissed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('ai_findings_review_id_idx').on(table.reviewId),
    index('ai_findings_job_id_idx').on(table.jobId),
    index('ai_findings_review_file_id_idx').on(table.reviewFileId),
    check('ai_findings_side_check', sql`${table.side} in (${sqlList(DIFF_SIDES)})`),
    check(
      'ai_findings_category_check',
      sql`${table.category} in (${sqlList(AI_FINDING_CATEGORIES)})`,
    ),
    check(
      'ai_findings_severity_check',
      sql`${table.severity} in (${sqlList(AI_FINDING_SEVERITIES)})`,
    ),
    check(
      'ai_findings_confidence_check',
      sql`${table.confidence} >= 0 and ${table.confidence} <= 1`,
    ),
  ],
);

export type AiAnalysisJobRow = typeof aiAnalysisJobs.$inferSelect;
export type AiFindingRow = typeof aiFindings.$inferSelect;
