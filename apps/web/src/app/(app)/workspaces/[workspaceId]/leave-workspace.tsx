'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { FormError } from '@/components/form-field';
import { dangerButton, secondaryButton } from '@/components/styles';
import { leaveWorkspace } from '@/lib/api-client';
import { describeApiError } from '@/lib/api-errors';

export function LeaveWorkspace({ workspaceId }: { workspaceId: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleLeave() {
    setError(null);
    setPending(true);
    const result = await leaveWorkspace(workspaceId);
    if (!result.ok) {
      setPending(false);
      setConfirming(false);
      setError(describeApiError(result));
      return;
    }
    // Stays pending while navigating: this page would now be a 404.
    router.push('/workspaces');
    router.refresh();
  }

  return (
    <div className="space-y-3">
      {error && <FormError>{error}</FormError>}
      {confirming ? (
        <div className="space-y-3">
          <p className="text-sm text-slate-300">
            You will lose access until someone adds you again.
          </p>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={pending}
              className={secondaryButton}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleLeave}
              disabled={pending}
              autoFocus
              className={dangerButton}
            >
              {pending ? 'Leaving…' : 'Yes, leave'}
            </button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => setConfirming(true)} className={secondaryButton}>
          Leave workspace
        </button>
      )}
    </div>
  );
}
