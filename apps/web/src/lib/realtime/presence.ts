import type { PresenceEvent } from '@diffcraft/shared';
import { isNotOlder } from './events';

const NAMED = 3;

// Two recomputes can arrive out of order (another instance, the newcomer's own copy): keep the newest.
export function newerPresence(current: PresenceEvent | null, next: PresenceEvent): PresenceEvent {
  return current && !isNotOlder(next.at, current.at) ? current : next;
}

export function describeViewers(
  { viewers, total }: Pick<PresenceEvent, 'viewers' | 'total'>,
  selfId: string,
): { label: string; description: string } {
  const listed = new Map(viewers.map((v) => [v.id, v.displayName]));
  const others = [...listed].filter(([id]) => id !== selfId).map(([, name]) => name);
  // Past the server's cap, you may be among the viewers left off the list.
  let unlisted = Math.max(0, total - listed.size);
  if (!listed.has(selfId) && unlisted > 0) unlisted -= 1;

  const othersCount = others.length + unlisted;
  if (othersCount === 0) {
    return { label: 'Only you viewing', description: 'Only you are viewing this review.' };
  }

  const shown = others.slice(0, NAMED - 1);
  const more = othersCount - shown.length;
  const label = `${['You', ...shown].join(', ')}${more > 0 ? ` +${more} more` : ''} viewing`;

  const extra = unlisted > 0 ? [`${unlisted} more`] : [];
  const everyone = ['you', ...others, ...extra];
  const list =
    everyone.length === 2
      ? everyone.join(' and ')
      : `${everyone.slice(0, -1).join(', ')} and ${everyone.at(-1)}`;
  return { label, description: `Viewing this review: ${list}.` };
}
