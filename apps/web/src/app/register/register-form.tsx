'use client';

import { RegisterRequestSchema } from '@diffcraft/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { FormError, FormField } from '@/components/form-field';
import { primaryButton, textLink } from '@/components/styles';
import { login, register } from '@/lib/api-client';
import { validateForm, type FieldErrors } from '@/lib/form-errors';

type FormErrorState =
  { kind: 'email_taken' } | { kind: 'login_failed' } | { kind: 'message'; message: string };

export function RegisterForm() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<FormErrorState | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setFormError(null);

    const input = validateForm(RegisterRequestSchema, {
      email: form.get('email'),
      displayName: form.get('displayName'),
      password: form.get('password'),
    });
    if (!input.success) {
      setFieldErrors(input.fieldErrors);
      return;
    }
    setFieldErrors({});

    setPending(true);
    const registered = await register(input.data);
    if (!registered.ok) {
      setPending(false);
      setFieldErrors(registered.fieldErrors);
      if (registered.status === 409) setFormError({ kind: 'email_taken' });
      else if (Object.keys(registered.fieldErrors).length === 0)
        setFormError({ kind: 'message', message: registered.message });
      return;
    }

    const loggedIn = await login({ email: input.data.email, password: input.data.password });
    if (!loggedIn.ok) {
      setPending(false);
      setFormError({ kind: 'login_failed' });
      return;
    }

    // Stays pending while navigating. refresh() makes server components re-read the new cookie.
    router.push('/workspaces');
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4">
      {formError && (
        <FormError>
          {formError.kind === 'email_taken' && (
            <>
              An account with this email already exists.{' '}
              <Link href="/login" className={textLink}>
                Log in instead
              </Link>
            </>
          )}
          {formError.kind === 'login_failed' && (
            <>
              Your account was created, but we couldn&apos;t sign you in.{' '}
              <Link href="/login" className={textLink}>
                Log in
              </Link>
            </>
          )}
          {formError.kind === 'message' && formError.message}
        </FormError>
      )}

      <FormField
        id="email"
        label="Email"
        type="email"
        autoComplete="email"
        required
        error={fieldErrors.email}
      />
      <FormField
        id="displayName"
        label="Display name"
        type="text"
        autoComplete="nickname"
        required
        error={fieldErrors.displayName}
      />
      <FormField
        id="password"
        label="Password"
        type="password"
        autoComplete="new-password"
        required
        hint="At least 10 characters."
        error={fieldErrors.password}
      />

      <button type="submit" disabled={pending} className={primaryButton}>
        {pending ? 'Creating account…' : 'Create account'}
      </button>

      <p className="text-center text-sm text-slate-400">
        Already have an account?{' '}
        <Link href="/login" className={textLink}>
          Log in
        </Link>
      </p>
    </form>
  );
}
