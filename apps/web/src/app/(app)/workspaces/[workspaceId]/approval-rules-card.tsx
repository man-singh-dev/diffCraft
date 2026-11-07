'use client';

import {
  hasAtLeastRole,
  MAX_REQUIRED_APPROVALS,
  type ApprovalRules,
  type WorkspaceRole,
} from '@diffcraft/shared';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { FormError, FormField } from '@/components/form-field';
import { secondaryButton } from '@/components/styles';
import { updateRules } from '@/lib/approval-actions';
import { run } from '@/lib/approval-errors';

const describeRequired = (n: number) =>
  n === 0 ? 'No approvals required' : `${n} ${n === 1 ? 'approval' : 'approvals'} required`;

export function ApprovalRulesCard({
  workspaceId,
  rules,
  role,
}: {
  workspaceId: string;
  rules: ApprovalRules;
  role: WorkspaceRole;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [saved, setSaved] = useState(false);

  if (!hasAtLeastRole(role, 'admin')) {
    return (
      <ul className="space-y-1 rounded-xl border border-slate-800 bg-slate-950/40 p-4 text-sm text-slate-300">
        <li>{describeRequired(rules.requiredApprovals)} before merging.</li>
        <li>
          {rules.requireResolvedThreads
            ? 'All threads must be resolved before merging.'
            : 'Open threads do not block merging.'}
        </li>
      </ul>
    );
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setError(null);
    setSaved(false);

    const raw = String(form.get('required-approvals') ?? '').trim();
    const requiredApprovals = /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
    if (!Number.isInteger(requiredApprovals) || requiredApprovals > MAX_REQUIRED_APPROVALS) {
      setFieldError(`Enter a whole number from 0 to ${MAX_REQUIRED_APPROVALS}.`);
      return;
    }
    setFieldError(undefined);

    setPending(true);
    const result = await run(() =>
      updateRules(workspaceId, {
        requiredApprovals,
        requireResolvedThreads: form.get('require-resolved-threads') === 'on',
      }),
    );
    setPending(false);
    if (!result.ok) {
      setError(result.error.message);
      setFieldError(result.error.fieldErrors?.requiredApprovals);
    } else {
      setSaved(true);
    }
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4">
      {error && <FormError>{error}</FormError>}
      {saved && (
        <p role="status" className="text-sm text-emerald-400">
          Saved.
        </p>
      )}
      <FormField
        id="required-approvals"
        label="Required approvals"
        type="number"
        inputMode="numeric"
        min={0}
        max={MAX_REQUIRED_APPROVALS}
        step={1}
        required
        defaultValue={rules.requiredApprovals}
        hint="Approvals from assigned reviewers needed before merging (0–10)."
        error={fieldError}
      />
      <label className="flex items-center gap-2 text-sm text-slate-200">
        <input
          type="checkbox"
          name="require-resolved-threads"
          defaultChecked={rules.requireResolvedThreads}
          className="accent-violet-500"
        />
        Require all threads resolved
      </label>
      <button type="submit" disabled={pending} className={secondaryButton}>
        {pending ? 'Saving…' : 'Save'}
      </button>
    </form>
  );
}
