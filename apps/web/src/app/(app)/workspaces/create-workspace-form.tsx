'use client';

import { CreateWorkspaceRequestSchema } from '@diffcraft/shared';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { FormError, FormField } from '@/components/form-field';
import { primaryButton } from '@/components/styles';
import { createWorkspace } from '@/lib/api-client';
import { describeApiError } from '@/lib/api-errors';
import { validateForm, type FieldErrors } from '@/lib/form-errors';

export function CreateWorkspaceForm() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setFormError(null);

    const input = validateForm(CreateWorkspaceRequestSchema, { name: form.get('name') });
    if (!input.success) {
      setFieldErrors(input.fieldErrors);
      return;
    }
    setFieldErrors({});

    setPending(true);
    const result = await createWorkspace(input.data);
    if (!result.ok) {
      setPending(false);
      setFieldErrors(result.fieldErrors);
      setFormError(describeApiError(result));
      return;
    }

    // Stays pending while navigating to the new workspace.
    router.push(`/workspaces/${result.data.id}`);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4">
      {formError && <FormError>{formError}</FormError>}
      <FormField
        id="name"
        label="Workspace name"
        type="text"
        required
        maxLength={80}
        hint="Up to 80 characters. You can rename it later."
        error={fieldErrors.name}
      />
      <button type="submit" disabled={pending} className={primaryButton}>
        {pending ? 'Saving…' : 'Create workspace'}
      </button>
    </form>
  );
}
