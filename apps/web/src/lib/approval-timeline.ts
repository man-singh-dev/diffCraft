import type { ReviewDecision, ReviewEvent } from '@diffcraft/shared';

export type TimelineEntry =
  | { kind: 'event'; id: string; createdAt: string; event: ReviewEvent }
  | { kind: 'decision'; id: string; createdAt: string; decision: ReviewDecision };

// ISO strings from the API all have the same shape, so comparing them as text compares the times.
function before(a: { createdAt: string; id: string }, b: { createdAt: string; id: string }) {
  return a.createdAt < b.createdAt || (a.createdAt === b.createdAt && a.id <= b.id);
}

// Both inputs must be oldest first (as the API returns them); decision events are skipped because the decision row, with its comment, stands for them.
export function mergeTimeline(
  events: readonly ReviewEvent[],
  decisions: readonly ReviewDecision[],
): TimelineEntry[] {
  const entries: TimelineEntry[] = [];
  let i = 0;
  let j = 0;
  while (i < events.length || j < decisions.length) {
    const event = events[i];
    const decision = decisions[j];
    if (event && (!decision || before(event, decision))) {
      i++;
      if (event.type !== 'decision') {
        entries.push({ kind: 'event', id: event.id, createdAt: event.createdAt, event });
      }
    } else if (decision) {
      j++;
      entries.push({ kind: 'decision', id: decision.id, createdAt: decision.createdAt, decision });
    }
  }
  return entries;
}

export const DELETED_USER = 'Deleted user';

const nameOf = (user: { displayName: string } | null) => user?.displayName ?? DELETED_USER;

export function describeEntry(entry: TimelineEntry, names: ReadonlyMap<string, string>): string {
  if (entry.kind === 'decision') {
    const { decision } = entry;
    const who = nameOf(decision.reviewer);
    return decision.decision === 'approve' ? `${who} approved` : `${who} requested changes`;
  }
  const { event } = entry;
  const actor = nameOf(event.actor);
  const targetId = typeof event.data.userId === 'string' ? event.data.userId : null;
  const target =
    targetId === null
      ? 'a former member'
      : targetId === event.actor?.id
        ? 'themselves'
        : (names.get(targetId) ?? 'a former member');

  switch (event.type) {
    case 'reviewer_assigned':
      return `${actor} assigned ${target}`;
    case 'reviewer_removed':
      return `${actor} removed ${target}`;
    case 'closed':
      return `${actor} closed`;
    case 'reopened':
      return `${actor} reopened`;
    case 'merged':
      return `${actor} merged`;
    case 'decision':
      return `${actor} reviewed`;
  }
}
