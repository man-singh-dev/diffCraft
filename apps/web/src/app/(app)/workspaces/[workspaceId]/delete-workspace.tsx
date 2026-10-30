'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { FormError, FormField } from '@/components/form-field';
import { dangerButton } from '@/components/styles';
import { deleteWorkspace } from '@/lib/api-client';
import { describeApiError } from '@/lib/api-errors';

/** Deletion can't be undone, so the owner has to type the name to enable the button. */
export function DeleteWorkspace({ workspaceId, name }: { workspaceId: string; name: string }) {
  const router = useRouter();
  const [typed, setTyped] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (typed !== name) return;
    setError(null);
    setPending(true);
    const result = await deleteWorkspace(workspaceId);
    if (!result.ok) {
      setPending(false);
      setError(describeApiError(result));
      return;
    }
    // Stays pending while navigating away from the deleted workspace.
    router.push('/workspaces');
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4">
      {error && <FormError>{error}</FormError>}
      <FormField
        id="confirm-delete"
        label={`Type "${name}" to confirm`}
        type="text"
        autoComplete="off"
        value={typed}
        onChange={(event) => setTyped(event.target.value)}
        hint="This deletes the workspace and removes every member. It can't be undone."
      />
      <button type="submit" disabled={pending || typed !== name} className={dangerButton}>
        {pending ? 'Deleting…' : 'Delete workspace'}
      </button>
    </form>
  );
}
