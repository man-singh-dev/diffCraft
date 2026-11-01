'use client';

import { CreateReviewRequestSchema } from '@diffcraft/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type ChangeEvent, type FormEvent } from 'react';
import { FormError, FormField, TextAreaField } from '@/components/form-field';
import { primaryButton, secondaryButton } from '@/components/styles';
import { createReview } from '@/lib/api-client';
import { readPatchFile } from '@/lib/decode-patch-file';
import { validateForm, type FieldErrors } from '@/lib/form-errors';
import { describeReviewError } from '@/lib/review-errors';
import { PatchPreview } from './patch-preview';

export function NewReviewForm({
  workspaceId,
  cancelHref,
}: {
  workspaceId: string;
  cancelHref: string;
}) {
  const router = useRouter();
  const [patch, setPatch] = useState('');
  const [fileError, setFileError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    setFileError(null);
    if (!file) return;
    const result = await readPatchFile(file);
    if (!result.ok) {
      setFileError(result.message);
      // Cleared so choosing the same file again (after fixing it) fires change again.
      event.target.value = '';
      return;
    }
    setPatch(result.text);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setFormError(null);

    const input = validateForm(CreateReviewRequestSchema, {
      title: form.get('title'),
      description: form.get('description'),
      patch,
    });
    if (!input.success) {
      setFieldErrors(input.fieldErrors);
      return;
    }
    setFieldErrors({});

    setPending(true);
    const result = await createReview(workspaceId, input.data);
    if (!result.ok) {
      setPending(false);
      setFieldErrors(result.fieldErrors);
      setFormError(describeReviewError(result));
      return;
    }
    // Stays pending while navigating to the new review.
    router.push(`/workspaces/${workspaceId}/reviews/${result.data.number}`);
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-5">
      {formError && <FormError>{formError}</FormError>}

      <FormField
        id="title"
        label="Title"
        type="text"
        required
        maxLength={200}
        autoComplete="off"
        error={fieldErrors.title}
      />

      <TextAreaField
        id="description"
        label="Description (optional)"
        rows={4}
        maxLength={10_000}
        error={fieldErrors.description}
      />

      <div className="space-y-1.5">
        <label htmlFor="patch-file" className="block text-sm font-medium text-slate-300">
          Patch file
        </label>
        <input
          id="patch-file"
          type="file"
          accept=".patch,.diff,.txt"
          onChange={handleFile}
          aria-describedby={fileError ? 'patch-file-error' : 'patch-file-hint'}
          className="block w-full text-sm text-slate-400 file:mr-3 file:rounded-md file:border file:border-slate-700 file:bg-slate-800 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-slate-200 hover:file:bg-slate-700"
        />
        {fileError ? (
          <p id="patch-file-error" role="alert" className="text-xs text-red-400">
            {fileError}
          </p>
        ) : (
          <p id="patch-file-hint" className="text-xs text-slate-500">
            UTF-8 or UTF-16, up to 1 MiB. It fills the box below, where you can still edit it.
          </p>
        )}
      </div>

      <TextAreaField
        id="patch"
        label="Patch"
        required
        rows={14}
        spellCheck={false}
        autoComplete="off"
        value={patch}
        onChange={(event) => setPatch(event.target.value)}
        placeholder="diff --git a/src/app.ts b/src/app.ts"
        hint="Output of git diff, git format-patch or diff -u."
        error={fieldErrors.patch}
        className="font-mono text-xs"
      />

      <PatchPreview patch={patch} />

      <div className="flex flex-col gap-3 sm:flex-row">
        <button type="submit" disabled={pending} className={primaryButton}>
          {pending ? 'Creating…' : 'Create review'}
        </button>
        <Link href={cancelHref} className={secondaryButton}>
          Cancel
        </Link>
      </div>
    </form>
  );
}
