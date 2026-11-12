import { createHash } from 'node:crypto';
import type { AiFinding, AiJob, LatestAnalysisResponse } from '@diffcraft/shared';
import { and, asc, count, desc, eq, gt, inArray, isNull, lt, sql } from 'drizzle-orm';
import {
  aiAnalysisJobs,
  aiFindings,
  reviewFiles,
  type AiAnalysisJobRow,
  type AiFindingRow,
  type ReviewFileRow,
} from '../../db/schema/index.js';
import type { Database } from '../../plugins/db.js';
import { AnalysisLimitError } from './errors.js';
import type { MappedFinding } from './mapping.js';
import type { TokenUsage } from './providers/types.js';

type Executor = Pick<Database, 'select' | 'insert' | 'update' | 'delete' | 'execute'>;

const DAY_MS = 24 * 60 * 60 * 1000;

export function toJobDto(row: AiAnalysisJobRow): AiJob {
  return {
    id: row.id,
    reviewId: row.reviewId,
    status: row.status,
    requestedBy: row.requestedBy,
    model: row.model,
    promptVersion: row.promptVersion,
    attempts: row.attempts,
    errorCode: row.errorCode,
    summary: row.summary,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    droppedFindings: row.droppedFindings,
    createdAt: row.createdAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null,
  };
}

function toFindingDto(row: AiFindingRow, filePath: string | null): AiFinding {
  return {
    id: row.id,
    jobId: row.jobId,
    reviewFileId: row.reviewFileId,
    filePath,
    side: row.side,
    lineStart: row.lineStart,
    lineEnd: row.lineEnd,
    category: row.category,
    severity: row.severity,
    title: row.title,
    explanation: row.explanation,
    suggestion: row.suggestion,
    confidence: row.confidence,
    dismissedAt: row.dismissedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export function idempotencyKey(reviewId: string, promptVersion: string, model: string): string {
  return createHash('sha256')
    .update(JSON.stringify([reviewId, promptVersion, model]))
    .digest('hex');
}

export async function requestAnalysis(
  db: Database,
  input: {
    workspaceId: string;
    reviewId: string;
    requestedBy: string;
    model: string;
    promptVersion: string;
    dailyLimit: number;
  },
): Promise<{ job: AiJob; created: boolean }> {
  const key = idempotencyKey(input.reviewId, input.promptVersion, input.model);
  return db.transaction(async (tx) => {
    // One request per workspace at a time, so two concurrent requests can't both pass the daily limit.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`ai-analysis:${input.workspaceId}`}, 0))`,
    );

    const [active] = await tx
      .select()
      .from(aiAnalysisJobs)
      .where(
        and(
          eq(aiAnalysisJobs.idempotencyKey, key),
          inArray(aiAnalysisJobs.status, ['queued', 'running']),
        ),
      )
      .limit(1);
    if (active) return { job: toJobDto(active), created: false };

    const inWindow = and(
      eq(aiAnalysisJobs.workspaceId, input.workspaceId),
      gt(aiAnalysisJobs.createdAt, sql`now() - interval '24 hours'`),
    );
    const [{ used } = { used: 0 }] = await tx
      .select({ used: count() })
      .from(aiAnalysisJobs)
      .where(inWindow);
    if (used >= input.dailyLimit) {
      // A slot frees up when the job that pushed the count to the limit leaves the window.
      const [freesUp] = await tx
        .select({ createdAt: aiAnalysisJobs.createdAt })
        .from(aiAnalysisJobs)
        .where(inWindow)
        .orderBy(asc(aiAnalysisJobs.createdAt))
        .offset(used - input.dailyLimit)
        .limit(1);
      const waitMs = freesUp ? freesUp.createdAt.getTime() + DAY_MS - Date.now() : DAY_MS;
      throw new AnalysisLimitError(input.dailyLimit, Math.max(1, Math.ceil(waitMs / 1000)));
    }

    const [job] = await tx
      .insert(aiAnalysisJobs)
      .values({
        workspaceId: input.workspaceId,
        reviewId: input.reviewId,
        requestedBy: input.requestedBy,
        idempotencyKey: key,
        promptVersion: input.promptVersion,
        model: input.model,
      })
      .returning();
    if (!job) throw new Error('no job returned');
    return { job: toJobDto(job), created: true };
  });
}

async function findingsWithPaths(
  db: Executor,
  where: ReturnType<typeof and>,
): Promise<AiFinding[]> {
  const rows = await db
    .select({ finding: aiFindings, newPath: reviewFiles.newPath, oldPath: reviewFiles.oldPath })
    .from(aiFindings)
    .leftJoin(reviewFiles, eq(reviewFiles.id, aiFindings.reviewFileId))
    .where(where)
    .orderBy(asc(reviewFiles.position), asc(aiFindings.lineStart), asc(aiFindings.id));
  return rows.map((row) => toFindingDto(row.finding, row.newPath ?? row.oldPath ?? null));
}

export async function getLatestAnalysis(
  db: Database,
  reviewId: string,
): Promise<LatestAnalysisResponse> {
  const newest = (status?: 'succeeded') =>
    db
      .select()
      .from(aiAnalysisJobs)
      .where(
        and(
          eq(aiAnalysisJobs.reviewId, reviewId),
          status ? eq(aiAnalysisJobs.status, status) : undefined,
        ),
      )
      .orderBy(desc(aiAnalysisJobs.createdAt), desc(aiAnalysisJobs.id))
      .limit(1);
  const [[job], [succeeded]] = await Promise.all([newest(), newest('succeeded')]);
  const findings = succeeded
    ? await findingsWithPaths(
        db,
        and(
          eq(aiFindings.jobId, succeeded.id),
          eq(aiFindings.reviewId, reviewId),
          isNull(aiFindings.dismissedAt),
        ),
      )
    : [];
  return { job: job ? toJobDto(job) : null, findings };
}

export async function dismissFinding(
  db: Database,
  reviewId: string,
  findingId: string,
): Promise<AiFinding | null> {
  const where = and(eq(aiFindings.id, findingId), eq(aiFindings.reviewId, reviewId));
  // coalesce: dismissing again keeps the first time, so the call is idempotent.
  const updated = await db
    .update(aiFindings)
    .set({ dismissedAt: sql`coalesce(${aiFindings.dismissedAt}, now())` })
    .where(where)
    .returning({ id: aiFindings.id });
  if (updated.length === 0) return null;
  const [finding] = await findingsWithPaths(db, where);
  return finding ?? null;
}

const addUsage = (usage: TokenUsage | null) =>
  usage
    ? {
        inputTokens: sql`coalesce(${aiAnalysisJobs.inputTokens}, 0) + ${usage.inputTokens}`,
        outputTokens: sql`coalesce(${aiAnalysisJobs.outputTokens}, 0) + ${usage.outputTokens}`,
      }
    : {};

// Conditional on 'queued': of two workers handed the same job, only one gets a row back.
export async function claimJob(db: Executor, jobId: string): Promise<AiAnalysisJobRow | null> {
  const [job] = await db
    .update(aiAnalysisJobs)
    .set({
      status: 'running',
      attempts: sql`${aiAnalysisJobs.attempts} + 1`,
      startedAt: sql`now()`,
      errorCode: null,
    })
    .where(and(eq(aiAnalysisJobs.id, jobId), eq(aiAnalysisJobs.status, 'queued')))
    .returning();
  return job ?? null;
}

export async function loadReviewFiles(db: Executor, reviewId: string): Promise<ReviewFileRow[]> {
  return db
    .select()
    .from(reviewFiles)
    .where(eq(reviewFiles.reviewId, reviewId))
    .orderBy(asc(reviewFiles.position));
}

const whileRunning = (jobId: string) =>
  and(eq(aiAnalysisJobs.id, jobId), eq(aiAnalysisJobs.status, 'running'));

export async function requeueJob(
  db: Executor,
  jobId: string,
  errorCode: string,
  usage: TokenUsage | null,
): Promise<AiAnalysisJobRow | null> {
  const [job] = await db
    .update(aiAnalysisJobs)
    .set({ status: 'queued', errorCode, ...addUsage(usage) })
    .where(whileRunning(jobId))
    .returning();
  return job ?? null;
}

export async function failJob(
  db: Executor,
  jobId: string,
  errorCode: string,
  usage: TokenUsage | null,
): Promise<AiAnalysisJobRow | null> {
  const [job] = await db
    .update(aiAnalysisJobs)
    .set({ status: 'failed', errorCode, finishedAt: sql`now()`, ...addUsage(usage) })
    .where(whileRunning(jobId))
    .returning();
  return job ?? null;
}

export async function completeJob(
  db: Database,
  job: Pick<AiAnalysisJobRow, 'id' | 'reviewId'>,
  result: {
    summary: string;
    findings: MappedFinding[];
    dropped: number;
    usage: TokenUsage | null;
  },
): Promise<AiAnalysisJobRow | null> {
  return db.transaction(async (tx) => {
    const [done] = await tx
      .update(aiAnalysisJobs)
      .set({
        status: 'succeeded',
        summary: result.summary,
        droppedFindings: result.dropped,
        finishedAt: sql`now()`,
        errorCode: null,
        ...addUsage(result.usage),
      })
      .where(whileRunning(job.id))
      .returning();
    // Failed by the sweeper meanwhile: keep it failed and store nothing.
    if (!done) return null;
    await tx.delete(aiFindings).where(eq(aiFindings.jobId, job.id));
    if (result.findings.length > 0) {
      await tx
        .insert(aiFindings)
        .values(result.findings.map((f) => ({ ...f, jobId: job.id, reviewId: job.reviewId })));
    }
    return done;
  });
}

export async function findStuckQueued(db: Executor, olderThanMs: number): Promise<string[]> {
  const rows = await db
    .select({ id: aiAnalysisJobs.id })
    .from(aiAnalysisJobs)
    .where(
      and(
        eq(aiAnalysisJobs.status, 'queued'),
        lt(aiAnalysisJobs.createdAt, sql`now() - ${olderThanMs} * interval '1 millisecond'`),
      ),
    )
    .orderBy(asc(aiAnalysisJobs.createdAt))
    .limit(100);
  return rows.map((row) => row.id);
}

export async function failStaleRunning(
  db: Executor,
  olderThanMs: number,
): Promise<AiAnalysisJobRow[]> {
  return db
    .update(aiAnalysisJobs)
    .set({ status: 'failed', errorCode: 'timed_out', finishedAt: sql`now()` })
    .where(
      and(
        eq(aiAnalysisJobs.status, 'running'),
        lt(aiAnalysisJobs.startedAt, sql`now() - ${olderThanMs} * interval '1 millisecond'`),
      ),
    )
    .returning();
}
