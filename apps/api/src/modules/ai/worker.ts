import { AiAnalysisResultSchema, formatZodIssues, type AiAnalysisResult } from '@diffcraft/shared';
import type { FastifyBaseLogger } from 'fastify';
import type { Database } from '../../plugins/db.js';
import { safeError } from '../realtime/socket-server.js';
import {
  buildContext,
  DEFAULT_CONTEXT_LIMITS,
  type AnalysisContext,
  type ContextLimits,
  type SkipReason,
} from './context.js';
import { InvalidOutputError, ProviderError, type InvalidOutputReason } from './errors.js';
import type { AnalysisPublisher } from './events.js';
import { mapFindings } from './mapping.js';
import { buildPrompt } from './prompt.js';
import type { AiProvider, AnalyzeInput, TokenUsage } from './providers/types.js';
import type { AnalysisQueue } from './queue.js';
import {
  claimJob,
  completeJob,
  failJob,
  failStaleRunning,
  findStuckQueued,
  loadReviewFiles,
  requeueJob,
  toJobDto,
} from './service.js';

export const MAX_ATTEMPTS = 3;
// A provider asking us to wait longer than this (e.g. a daily quota) fails the job instead of holding it.
export const MAX_RETRY_AFTER_MS = 5 * 60_000;

export class RetryLaterError extends Error {
  constructor(
    readonly code: string,
    readonly retryAfterMs?: number,
  ) {
    super(code);
    this.name = 'RetryLaterError';
  }
}

export interface WorkerDeps {
  db: Database;
  provider: AiProvider;
  log: FastifyBaseLogger;
  publisher: AnalysisPublisher;
  limits?: ContextLimits;
  maxAttempts?: number;
}

export type JobOutcome = 'succeeded' | 'failed' | 'skipped';

const addUsage = (a: TokenUsage | null, b: TokenUsage | null): TokenUsage | null =>
  a && b
    ? { inputTokens: a.inputTokens + b.inputTokens, outputTokens: a.outputTokens + b.outputTokens }
    : (a ?? b);

const REPAIR_PROBLEMS: Record<InvalidOutputReason, string> = {
  truncated: 'it was cut off before the JSON object was complete. Keep the answer shorter.',
  empty: 'it was empty.',
  not_json: 'it was not a parseable JSON object.',
  schema: 'it did not match the required shape.',
};

async function analyzeWithRepair(
  provider: AiProvider,
  context: AnalysisContext,
  onUsage: (usage: TokenUsage | null) => void,
): Promise<AiAnalysisResult> {
  const prompt = buildPrompt(context);
  let repair: AnalyzeInput['repair'];
  let lastReason: InvalidOutputReason = 'schema';
  for (let call = 0; call < 2; call++) {
    try {
      const output = await provider.analyze({ prompt, context, ...(repair && { repair }) });
      onUsage(output.usage);
      const parsed = AiAnalysisResultSchema.safeParse(output.result);
      if (parsed.success) return parsed.data;
      lastReason = 'schema';
      repair = {
        previousOutput: output.raw,
        problem: `${REPAIR_PROBLEMS.schema}\n${formatZodIssues(parsed.error.issues.slice(0, 20))}`,
      };
    } catch (err) {
      if (!(err instanceof InvalidOutputError)) throw err;
      onUsage(err.usage);
      lastReason = err.reason;
      repair = { previousOutput: err.rawOutput ?? '', problem: REPAIR_PROBLEMS[err.reason] };
    }
  }
  throw new InvalidOutputError(lastReason, undefined, null);
}

const SKIP_LABELS: Record<Exclude<SkipReason, 'over_budget'>, string> = {
  binary: 'binary',
  deleted: 'deleted',
  lockfile: 'lockfile',
  minified: 'minified or generated',
  too_large: 'too large',
  no_changes: 'without line changes',
};

function contextNote(context: AnalysisContext, limits: ContextLimits): string {
  const notes: string[] = [];
  if (context.truncated) {
    notes.push(
      `Only the first ${context.files.length} of ${context.totalFiles} files were analyzed: the change is larger than the ${limits.maxChangedLines}-line analysis budget.`,
    );
  }
  const counts = new Map<string, number>();
  for (const { reason } of context.skipped) {
    if (reason !== 'over_budget') counts.set(reason, (counts.get(reason) ?? 0) + 1);
  }
  if (counts.size > 0) {
    const parts = [...counts].map(
      ([reason, n]) => `${n} ${SKIP_LABELS[reason as keyof typeof SKIP_LABELS]}`,
    );
    notes.push(`Skipped files: ${parts.join(', ')}.`);
  }
  return notes.join(' ');
}

export async function processAnalysisJob(deps: WorkerDeps, jobId: string): Promise<JobOutcome> {
  const { db, provider, publisher } = deps;
  const limits = deps.limits ?? DEFAULT_CONTEXT_LIMITS;
  const maxAttempts = deps.maxAttempts ?? MAX_ATTEMPTS;
  const startedAt = Date.now();

  const job = await claimJob(db, jobId);
  if (!job) {
    deps.log.info({ jobId }, 'analysis job not queued, skipping');
    return 'skipped';
  }
  const log = deps.log.child({ jobId, reviewId: job.reviewId, attempt: job.attempts });
  await publisher.status(toJobDto(job));

  let usage: TokenUsage | null = null;
  try {
    const context = buildContext(await loadReviewFiles(db, job.reviewId), limits);
    const analysis =
      context.files.length === 0
        ? { summary: 'There were no files to analyze.', findings: [] }
        : await analyzeWithRepair(provider, context, (u) => (usage = addUsage(usage, u)));
    const { mapped, dropped } = mapFindings(analysis.findings, context.files);
    const summary = [analysis.summary, contextNote(context, limits)].filter(Boolean).join('\n\n');

    const done = await completeJob(db, job, { summary, findings: mapped, dropped, usage });
    if (!done) {
      log.warn('analysis job was no longer running, result discarded');
      return 'skipped';
    }
    log.info(
      {
        durationMs: Date.now() - startedAt,
        files: context.files.length,
        skippedFiles: context.skipped.length,
        findings: mapped.length,
        droppedFindings: dropped,
        inputTokens: done.inputTokens,
        outputTokens: done.outputTokens,
      },
      'analysis job succeeded',
    );
    const dto = toJobDto(done);
    await publisher.status(dto);
    await publisher.completed(dto, mapped.length);
    return 'succeeded';
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    let code: string;
    let retryable: boolean;
    let retryAfterMs: number | undefined;
    if (err instanceof ProviderError) {
      ({ code, retryable, retryAfterMs } = err);
      if (retryAfterMs !== undefined && retryAfterMs > MAX_RETRY_AFTER_MS) retryable = false;
      log.warn({ durationMs, errorCode: code, retryAfterMs }, 'analysis provider call failed');
    } else if (err instanceof InvalidOutputError) {
      code = 'invalid_output';
      retryable = false;
      log.warn({ durationMs, reason: err.reason }, 'analysis output invalid after repair');
    } else {
      code = 'internal_error';
      retryable = true;
      log.error({ durationMs, err: safeError(err) }, 'analysis job error');
    }

    if (retryable && job.attempts < maxAttempts) {
      const requeued = await requeueJob(db, job.id, code, usage);
      if (!requeued) return 'skipped';
      await publisher.status(toJobDto(requeued));
      throw new RetryLaterError(code, retryAfterMs);
    }
    const failed = await failJob(db, job.id, code, usage);
    if (!failed) return 'skipped';
    log.info({ errorCode: code, attempts: failed.attempts }, 'analysis job failed');
    await publisher.status(toJobDto(failed));
    return 'failed';
  }
}

export interface SweeperDeps {
  db: Database;
  queue: AnalysisQueue;
  publisher: AnalysisPublisher;
  log: FastifyBaseLogger;
}

export interface SweepOptions {
  stuckQueuedMs: number;
  staleRunningMs: number;
}

export const DEFAULT_SWEEP_OPTIONS: SweepOptions = {
  stuckQueuedMs: 2 * 60_000,
  staleRunningMs: 10 * 60_000,
};

// Re-adding a job that is still waiting or delayed in BullMQ is a no-op: its jobId is the analysis job id.
export async function sweep(
  deps: SweeperDeps,
  options: SweepOptions = DEFAULT_SWEEP_OPTIONS,
): Promise<{ requeued: number; failed: number }> {
  const stuck = await findStuckQueued(deps.db, options.stuckQueuedMs);
  let requeued = 0;
  for (const id of stuck) {
    try {
      await deps.queue.enqueue(id);
      requeued += 1;
    } catch (err) {
      deps.log.error({ err: safeError(err), jobId: id }, 'analysis re-enqueue failed');
    }
  }
  const stale = await failStaleRunning(deps.db, options.staleRunningMs);
  for (const job of stale) {
    deps.log.warn({ jobId: job.id, reviewId: job.reviewId }, 'analysis job timed out');
    await deps.publisher.status(toJobDto(job));
  }
  return { requeued, failed: stale.length };
}

export function startSweeper(
  deps: SweeperDeps,
  intervalMs = 60_000,
  options: SweepOptions = DEFAULT_SWEEP_OPTIONS,
): { stop(): Promise<void> } {
  let timer: NodeJS.Timeout | undefined;
  let running: Promise<void> | undefined;
  let started = true;
  // setTimeout after each run, not setInterval: a slow sweep never overlaps the next one.
  const schedule = () => {
    timer = setTimeout(() => {
      running = sweep(deps, options)
        .then(() => undefined)
        .catch((err: unknown) => {
          deps.log.error({ err: safeError(err) }, 'analysis sweep failed');
        })
        .finally(() => {
          running = undefined;
          if (started) schedule();
        });
    }, intervalMs);
  };
  schedule();
  return {
    async stop() {
      started = false;
      clearTimeout(timer);
      await running;
    },
  };
}
