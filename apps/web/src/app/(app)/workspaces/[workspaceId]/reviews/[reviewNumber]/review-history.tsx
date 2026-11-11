import type { ReviewDecision, ReviewEvent } from '@diffcraft/shared';
import { LocalTime } from '@/components/local-time';
import { describeEntry, mergeTimeline } from '@/lib/approval-timeline';

export function ReviewHistory({
  events,
  decisions,
  names,
}: {
  events: ReviewEvent[];
  decisions: ReviewDecision[];
  names: ReadonlyMap<string, string>;
}) {
  const entries = mergeTimeline(events, decisions);

  return (
    <section aria-labelledby="history" className="space-y-3">
      <h2 id="history" className="text-sm font-semibold text-slate-200">
        History
      </h2>
      {entries.length === 0 ? (
        <p className="text-sm text-slate-500">Nothing has happened yet.</p>
      ) : (
        <ol className="space-y-3 border-l border-slate-800 pl-4">
          {entries.map((entry) => (
            <li key={`${entry.kind}:${entry.id}`} className="space-y-1">
              <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
                <span className="text-slate-200">{describeEntry(entry, names)}</span>
                <span className="text-xs text-slate-500">
                  <LocalTime iso={entry.createdAt} />
                </span>
              </p>
              {entry.kind === 'decision' && entry.decision.body && (
                // Plain text: React escapes it, and line breaks are kept by CSS, not by markup.
                <p className="whitespace-pre-wrap break-words rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2 text-sm text-slate-300">
                  {entry.decision.body}
                </p>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
