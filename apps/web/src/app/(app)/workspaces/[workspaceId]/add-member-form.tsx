'use client';

import { AddMemberRequestSchema, type WorkspaceRole } from '@diffcraft/shared';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { FormError, FormField, SelectField } from '@/components/form-field';
import { roleLabel } from '@/components/role-badge';
import { primaryButton } from '@/components/styles';
import { addMember } from '@/lib/api-client';
import { describeApiError } from '@/lib/api-errors';
import { validateForm, type FieldErrors } from '@/lib/form-errors';

export function AddMemberForm({
  workspaceId,
  roles,
}: {
  workspaceId: string;
  /** Only the roles the current user may grant. */
  roles: readonly WorkspaceRole[];
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [added, setAdded] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setFormError(null);
    setAdded(null);

    const input = validateForm(AddMemberRequestSchema, {
      email: form.get('member-email'),
      role: form.get('member-role'),
    });
    if (!input.success) {
      setFieldErrors(input.fieldErrors);
      return;
    }
    setFieldErrors({});

    setPending(true);
    const result = await addMember(workspaceId, input.data);
    setPending(false);
    if (!result.ok) {
      setFieldErrors(result.fieldErrors);
      setFormError(describeApiError(result));
      return;
    }

    formElement.reset();
    setAdded(`${result.data.displayName} was added as ${roleLabel(result.data.role)}.`);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4">
      {formError && <FormError>{formError}</FormError>}
      {added && (
        <p role="status" className="text-sm text-emerald-400">
          {added}
        </p>
      )}
      <FormField
        id="member-email"
        label="Email"
        type="email"
        autoComplete="off"
        required
        hint="They need a DiffCraft account already."
        error={fieldErrors.email}
      />
      <SelectField
        id="member-role"
        label="Role"
        defaultValue={roles.includes('member') ? 'member' : roles[0]}
        options={roles.map((r) => ({ value: r, label: roleLabel(r) }))}
        error={fieldErrors.role}
      />
      <button type="submit" disabled={pending} className={primaryButton}>
        {pending ? 'Saving…' : 'Add member'}
      </button>
    </form>
  );
}
