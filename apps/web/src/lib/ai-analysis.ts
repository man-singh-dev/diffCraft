import {
  AI_FINDING_SEVERITIES,
  type AiFinding,
  type AiFindingSeverity,
  type AiJob,
  type LatestAnalysisResponse,
} from '@diffcraft/shared';
import { isNotOlder } from './realtime/events';
import { threadKey, type LineTarget } from './thread-anchors';

export const SEVERITY_ORDER: readonly AiFindingSeverity[] = [...AI_FINDING_SEVERITIES].reverse();

export interface SeverityGroup {
  severity: AiFindingSeverity;
  findings: AiFinding[];
}

export function groupBySeverity(findings: readonly AiFinding[]): SeverityGroup[] {
  return SEVERITY_ORDER.map((severity) => ({
    severity,
    findings: findings.filter((f) => f.severity === severity),
  })).filter((group) => group.findings.length > 0);
}

export function severityCounts(findings: readonly AiFinding[]): string {
  return groupBySeverity(findings)
    .map((group) => `${group.findings.length} ${group.severity}`)
    .join(' · ');
}

export function findingTarget(finding: AiFinding): LineTarget | null {
  if (finding.reviewFileId === null || finding.lineStart === null) return null;
  return { fileId: finding.reviewFileId, side: finding.side ?? 'new', line: finding.lineStart };
}

export function groupFindingsByKey(findings: readonly AiFinding[]): Map<string, AiFinding[]> {
  const groups = new Map<string, AiFinding[]>();
  for (const finding of findings) {
    const target = findingTarget(finding);
    if (!target) continue;
    const key = threadKey(target.fileId, target.side, target.line);
    const group = groups.get(key);
    if (group) group.push(finding);
    else groups.set(key, [finding]);
  }
  return groups;
}

export function findingLocation(finding: AiFinding): string | null {
  if (finding.filePath === null || finding.lineStart === null) return finding.filePath;
  const end =
    finding.lineEnd !== null && finding.lineEnd !== finding.lineStart ? `-${finding.lineEnd}` : '';
  return `${finding.filePath}:${finding.lineStart}${end}`;
}

// A suggestion block replaces exactly the line the thread is on, so only a one-line finding on the new side gets one.
export function canSuggest(finding: AiFinding): boolean {
  return (
    finding.suggestion !== null &&
    finding.suggestion.trim() !== '' &&
    finding.side === 'new' &&
    (finding.lineEnd === null || finding.lineEnd === finding.lineStart)
  );
}

export function findingThreadBody(finding: AiFinding): string {
  const parts = [`**${finding.title}**`, finding.explanation];
  if (canSuggest(finding)) parts.push(`\`\`\`suggestion\n${finding.suggestion}\n\`\`\``);
  return parts.join('\n\n');
}

const JOB_ERROR_MESSAGES: Partial<Record<string, string>> = {
  provider_rate_limited:
    'The AI provider is rate limiting requests right now. Try again in a few minutes.',
  provider_timeout: 'The analysis took too long and was stopped. Try again.',
  timed_out: 'The analysis took too long and was stopped. Try again.',
  invalid_output: "The AI's answer couldn't be read, even after asking it to fix it. Try again.",
  provider_auth:
    "The AI provider rejected the server's API key or model. Ask an administrator to check the AI settings.",
  provider_model_not_found:
    "The AI provider rejected the server's API key or model. Ask an administrator to check the AI settings.",
  provider_unavailable: 'The AI provider is unavailable right now. Try again later.',
  provider_error: 'The AI provider is unavailable right now. Try again later.',
  provider_bad_request: 'The AI provider refused this change. It may be too large to analyze.',
  provider_rejected: 'The AI provider refused this change. It may be too large to analyze.',
};

export function jobErrorMessage(code: string | null): string {
  return (code && JOB_ERROR_MESSAGES[code]) ?? 'Something went wrong on our side. Try again.';
}

export function availableAt(retryAfterSeconds: number, nowMs: number): string {
  return new Date(nowMs + retryAfterSeconds * 1000).toISOString();
}

export function withFeedback(finding: AiFinding, helpful: boolean | null): AiFinding {
  const count = { ...finding.feedback };
  if (finding.myFeedback === true) count.helpful -= 1;
  if (finding.myFeedback === false) count.notHelpful -= 1;
  if (helpful === true) count.helpful += 1;
  if (helpful === false) count.notHelpful += 1;
  return {
    ...finding,
    myFeedback: helpful,
    feedback: { helpful: Math.max(0, count.helpful), notHelpful: Math.max(0, count.notHelpful) },
  };
}

export interface AnalysisState {
  enabled: boolean;
  job: AiJob | null;
  findings: AiFinding[];
  /** Time of the newest information applied, from a fetch or an event. */
  at: string | undefined;
  hidden: ReadonlySet<string>;
}

export type AnalysisAction =
  | { type: 'loaded'; latest: LatestAnalysisResponse; loadedAt: string }
  | { type: 'status'; job: AiJob; at: string }
  | { type: 'started'; job: AiJob }
  | { type: 'hide'; id: string }
  | { type: 'unhide'; id: string }
  | { type: 'finding'; finding: AiFinding };

export function initialAnalysisState(
  latest: LatestAnalysisResponse | null,
  loadedAt: string,
): AnalysisState {
  return {
    enabled: latest?.enabled ?? false,
    job: latest?.job ?? null,
    findings: latest?.findings ?? [],
    at: latest ? loadedAt : undefined,
    hidden: new Set(),
  };
}

const olderJob = (job: AiJob, than: AiJob | null) =>
  than !== null && job.id !== than.id && job.createdAt < than.createdAt;

export function analysisReducer(state: AnalysisState, action: AnalysisAction): AnalysisState {
  switch (action.type) {
    case 'loaded': {
      const { latest, loadedAt } = action;
      const stale = !isNotOlder(loadedAt, state.at);
      const keepJob =
        stale && state.job !== null && (latest.job === null || !olderJob(state.job, latest.job));
      const ids = new Set(latest.findings.map((f) => f.id));
      return {
        enabled: latest.enabled,
        job: keepJob ? state.job : latest.job,
        findings: latest.findings,
        at: stale ? state.at : loadedAt,
        hidden: new Set([...state.hidden].filter((id) => ids.has(id))),
      };
    }
    case 'status': {
      if (!isNotOlder(action.at, state.at) || olderJob(action.job, state.job)) return state;
      return { ...state, job: action.job, at: action.at };
    }
    case 'started': {
      if (state.job?.id === action.job.id || olderJob(action.job, state.job)) return state;
      return { ...state, job: action.job };
    }
    case 'hide':
      return { ...state, hidden: new Set([...state.hidden, action.id]) };
    case 'unhide':
      return { ...state, hidden: new Set([...state.hidden].filter((id) => id !== action.id)) };
    case 'finding':
      return {
        ...state,
        findings: state.findings.map((f) => (f.id === action.finding.id ? action.finding : f)),
      };
  }
}

export const visibleFindings = (state: AnalysisState): AiFinding[] =>
  state.findings.filter((f) => !state.hidden.has(f.id));

export type OptimisticResult<T, E> = { ok: true; data: T } | { ok: false; error: E };

export async function optimistic<T, E>(steps: {
  apply: () => void;
  call: () => Promise<OptimisticResult<T, E>>;
  commit: (data: T) => void;
  rollback: (error: E) => void;
}): Promise<OptimisticResult<T, E>> {
  steps.apply();
  const result = await steps.call();
  if (result.ok) steps.commit(result.data);
  else steps.rollback(result.error);
  return result;
}
