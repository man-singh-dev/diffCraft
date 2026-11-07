import type { Decision, ReviewState } from '@diffcraft/shared';

// UTC so the time doesn't depend on the server's (or browser's) time zone.
const dateTime = new Intl.DateTimeFormat('en', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'UTC',
});

export function DateTime({ value }: { value: string }) {
  return <time dateTime={value}>{dateTime.format(new Date(value))} UTC</time>;
}

const badge = 'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium';

const STATE_STYLES: Record<ReviewState['state'], { label: string; className: string }> = {
  pending: { label: 'Pending', className: 'border-amber-700 bg-amber-950/50 text-amber-200' },
  approved: {
    label: 'Approved',
    className: 'border-emerald-700 bg-emerald-950/60 text-emerald-200',
  },
  changes_requested: {
    label: 'Changes requested',
    className: 'border-red-800 bg-red-950/50 text-red-200',
  },
};

export function DecisionStateBadge({ state }: { state: ReviewState['state'] }) {
  const { label, className } = STATE_STYLES[state];
  return <span className={`${badge} ${className}`}>{label}</span>;
}

export function approvalCount({ approvals, requiredApprovals }: ReviewState): string {
  if (requiredApprovals === 0) {
    return `${approvals} ${approvals === 1 ? 'approval' : 'approvals'}, none required`;
  }
  return `${approvals} of ${requiredApprovals} ${requiredApprovals === 1 ? 'approval' : 'approvals'}`;
}

const DECISION_MARKS: Record<Decision | 'waiting', { icon: string; label: string }> = {
  approve: { icon: '✅', label: 'Approved' },
  request_changes: { icon: '❌', label: 'Changes requested' },
  waiting: { icon: '⏳', label: 'Waiting' },
};

export function DecisionMark({ decision }: { decision: Decision | null }) {
  const { icon, label } = DECISION_MARKS[decision ?? 'waiting'];
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-slate-300">
      <span aria-hidden="true">{icon}</span>
      {label}
    </span>
  );
}
