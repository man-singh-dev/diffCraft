'use client';

import { UpdateWorkspaceRequestSchema } from '@diffcraft/shared';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { FormError, FormField } from '@/components/form-field';
import { secondaryButton } from '@/components/styles';
import { renameWorkspace } from '@/lib/api-client';
import { describeApiError } from '@/lib/api-errors';
import { validateForm, type FieldErrors } from '@/lib/form-errors';

export function RenameWorkspaceForm({ workspaceId, name }: { workspaceId: string; name: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setFormError(null);
    setSaved(false);

    const input = validateForm(UpdateWorkspaceRequestSchema, { name: form.get('workspace-name') });
    if (!input.success) {
      setFieldErrors(input.fieldErrors);
      return;
    }
    setFieldErrors({});

    setPending(true);
    const result = await renameWorkspace(workspaceId, input.data);
    setPending(false);
    if (!result.ok) {
      setFieldErrors(result.fieldErrors);
      setFormError(describeApiError(result));
      return;
    }
    setSaved(true);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4">
      {formError && <FormError>{formError}</FormError>}
      {saved && (
        <p role="status" className="text-sm text-emerald-400">
          Saved. The slug stays the same.
        </p>
      )}
      <FormField
        id="workspace-name"
        label="Workspace name"
        type="text"
        required
        maxLength={80}
        defaultValue={name}
        error={fieldErrors.name}
      />
      <button type="submit" disabled={pending} className={secondaryButton}>
        {pending ? 'Saving…' : 'Rename'}
      </button>
    </form>
  );
}
