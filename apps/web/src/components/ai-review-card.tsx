'use client';

import type { AiJob } from '@diffcraft/shared';
import { useState } from 'react';
import { availableAt, jobErrorMessage, severityCounts } from '@/lib/ai-analysis';
import type { AiActionError } from '@/lib/ai-errors';
import { AiBadge, FindingList } from './ai-finding';
import { useAiAnalysis } from './ai-analysis-provider';
import { LocalTime } from './local-time';
import { smallSecondaryButton } from './styles';

const runButton =
  'inline-flex items-center justify-center rounded-md bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-violet-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 disabled:cursor-not-allowed disabled:opacity-60';

function Spinner() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="size-4 text-violet-300 motion-safe:animate-spin"
      fill="none"
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function statusText(job: AiJob | null, findingCount: number): string {
  if (!job) return 'No AI review yet.';
  switch (job.status) {
    case 'queued':
      return 'AI review waiting to start.';
    case 'running':
      return 'AI review analyzing the change.';
    case 'succeeded':
      return `AI review finished with ${findingCount} ${findingCount === 1 ? 'finding' : 'findings'}.`;
    case 'failed':
      return 'AI review failed.';
  }
}

function runLabel(job: AiJob | null): string {
  if (job?.status === 'failed') return 'Try again';
  if (job?.status === 'succeeded') return 'Run again';
  return 'Run AI review';
}

interface RunError {
  error: AiActionError;
  availableAt: string | null;
}

export function RunErrorMessage({ error, availableAt }: RunError) {
  return (
    <p role="alert" className="text-sm text-red-300">
      {error.message}
      {availableAt && (
        <>
          {' '}
          Available again <LocalTime iso={availableAt} />.
        </>
      )}
    </p>
  );
}

export function AiReviewCard() {
  const ai = useAiAnalysis();
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<RunError | null>(null);
  if (!ai) return null;
  const { job, enabled } = ai.state;
  if (!enabled && !job && ai.findings.length === 0 && !ai.loadFailed) return null;

  const active = job?.status === 'queued' || job?.status === 'running';
  const showRun = enabled && ai.canAct;
  const fromEarlierRun = job !== null && ai.findings.length > 0 && ai.findings[0]!.jobId !== job.id;

  async function run() {
    setRunning(true);
    setRunError(null);
    const error = await ai!.run();
    setRunning(false);
    if (error) {
      setRunError({
        error,
        availableAt:
          error.retryAfterSeconds !== undefined
            ? availableAt(error.retryAfterSeconds, Date.now())
            : null,
      });
    }
  }

  return (
    <section
      aria-labelledby="ai-review"
      className="space-y-3 rounded-xl border border-slate-800 bg-slate-950/40 p-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="ai-review" className="text-sm font-semibold text-slate-200">
          AI review
        </h2>
        <AiBadge />
        <span className="text-xs text-slate-500">AI-generated and may be wrong.</span>
        {showRun && (
          <button
            type="button"
            onClick={() => void run()}
            disabled={active || running || !ai.reviewOpen}
            className={`ml-auto ${runButton}`}
          >
            {running ? 'Starting…' : runLabel(job)}
          </button>
        )}
      </div>

      <p role="status" className="sr-only">
        {statusText(job, ai.findings.length)}
      </p>

      {showRun && !ai.reviewOpen && !active && (
        <p className="text-xs text-slate-500">Only open reviews can be analyzed.</p>
      )}

      {runError && <RunErrorMessage {...runError} />}

      {ai.loadFailed && !job && (
        <p className="text-sm text-amber-300">
          The AI review couldn&apos;t be loaded. Reload the page to try again.
        </p>
      )}

      {!job && !ai.loadFailed && (
        <p className="text-sm text-slate-400">
          Ask an AI model to look for bugs, security issues and performance problems in this change.
          The diff is sent to the configured AI provider.
        </p>
      )}

      {job?.status === 'queued' && (
        <p className="text-sm text-slate-300" aria-hidden="true">
          Waiting…
        </p>
      )}

      {job?.status === 'running' && (
        <p className="flex items-center gap-2 text-sm text-slate-300" aria-hidden="true">
          <Spinner />
          Analyzing…
        </p>
      )}

      {job?.status === 'failed' && (
        <div className="space-y-2 rounded-lg border border-red-900 bg-red-950/30 p-3 text-sm">
          <p className="text-red-200">{jobErrorMessage(job.errorCode)}</p>
          {showRun && ai.reviewOpen && (
            <button
              type="button"
              onClick={() => void run()}
              disabled={running}
              className={smallSecondaryButton}
            >
              Try again
            </button>
          )}
        </div>
      )}

      {job?.status === 'succeeded' && (
        <div className="space-y-2 text-sm">
          {job.summary && (
            <p className="whitespace-pre-wrap break-words text-slate-300">{job.summary}</p>
          )}
          <p className="text-slate-300">
            {ai.findings.length === 0
              ? 'No open findings.'
              : `${ai.findings.length} ${ai.findings.length === 1 ? 'finding' : 'findings'}: ${severityCounts(ai.findings)}`}
          </p>
          <p className="text-xs text-slate-500">
            {job.model}
            {job.finishedAt && (
              <>
                {' · '}
                <LocalTime iso={job.finishedAt} />
              </>
            )}
            {job.droppedFindings > 0 &&
              ` · ${job.droppedFindings} left out because they didn't point at a changed line`}
          </p>
        </div>
      )}

      {ai.findings.length > 0 && (
        <>
          {fromEarlierRun && <p className="text-xs text-slate-500">From the previous run:</p>}
          <FindingList findings={ai.findings} />
        </>
      )}
    </section>
  );
}

export function AiFindingsToggle() {
  const ai = useAiAnalysis();
  if (!ai || ai.findings.length === 0) return null;
  return (
    <label className="flex items-center gap-2 text-sm text-slate-300">
      <input
        type="checkbox"
        checked={ai.showInline}
        onChange={(event) => ai.setShowInline(event.target.checked)}
        className="size-4 accent-violet-500"
      />
      Show AI findings ({ai.findings.length})
    </label>
  );
}
