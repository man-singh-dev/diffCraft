'use client';

import type { WorkspaceMember, WorkspaceRole } from '@diffcraft/shared';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { roleLabel } from '@/components/role-badge';
import { smallDangerButton, smallSecondaryButton } from '@/components/styles';
import { changeMemberRole, removeMember } from '@/lib/api-client';
import { describeApiError } from '@/lib/api-errors';

const selectClass =
  'rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-100 focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-500/30 disabled:opacity-60';

/** Role select and Remove button for one member the current user may manage. */
export function MemberControls({
  workspaceId,
  member,
  roles,
}: {
  workspaceId: string;
  member: WorkspaceMember;
  /** The roles the current user may give this member (includes the current one). */
  roles: readonly WorkspaceRole[];
}) {
  const router = useRouter();
  const [role, setRole] = useState(member.role);
  const [pending, setPending] = useState<'role' | 'remove' | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectId = `role-${member.userId}`;
  const errorId = `member-${member.userId}-error`;

  async function handleRoleChange(next: WorkspaceRole) {
    setRole(next);
    setError(null);
    setPending('role');
    const result = await changeMemberRole(workspaceId, member.userId, { role: next });
    setPending(null);
    if (!result.ok) {
      setRole(member.role);
      setError(describeApiError(result));
    }
    // Also after a failure: a 403 or 404 means this row is out of date.
    router.refresh();
  }

  async function handleRemove() {
    setError(null);
    setPending('remove');
    const result = await removeMember(workspaceId, member.userId);
    if (!result.ok) {
      setPending(null);
      setConfirming(false);
      setError(describeApiError(result));
    }
    router.refresh();
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex items-center gap-2">
        <label htmlFor={selectId} className="sr-only">
          Role for {member.displayName}
        </label>
        <select
          id={selectId}
          value={role}
          disabled={pending !== null}
          onChange={(event) => handleRoleChange(event.target.value as WorkspaceRole)}
          aria-describedby={error ? errorId : undefined}
          className={selectClass}
        >
          {roles.map((r) => (
            <option key={r} value={r}>
              {roleLabel(r)}
            </option>
          ))}
        </select>

        {confirming ? (
          <>
            <button
              type="button"
              onClick={handleRemove}
              disabled={pending !== null}
              autoFocus
              className={smallDangerButton}
            >
              {pending === 'remove' ? 'Removing…' : `Remove ${member.displayName}`}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={pending !== null}
              className={smallSecondaryButton}
            >
              Cancel
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            disabled={pending !== null}
            className={smallDangerButton}
          >
            Remove
          </button>
        )}
      </div>
      {pending === 'role' && (
        <p role="status" className="text-xs text-slate-400">
          Saving…
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="max-w-xs text-right text-xs text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
