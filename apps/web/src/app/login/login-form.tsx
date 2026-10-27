'use client';

import { LoginRequestSchema } from '@diffcraft/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { FormError, FormField } from '@/components/form-field';
import { primaryButton, textLink } from '@/components/styles';
import { login } from '@/lib/api-client';
import { validateForm, type FieldErrors } from '@/lib/form-errors';

export function LoginForm() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setFormError(null);

    const input = validateForm(LoginRequestSchema, {
      email: form.get('email'),
      password: form.get('password'),
    });
    if (!input.success) {
      setFieldErrors(input.fieldErrors);
      return;
    }
    setFieldErrors({});

    setPending(true);
    const result = await login(input.data);
    if (!result.ok) {
      setPending(false);
      setFieldErrors(result.fieldErrors);
      setFormError(result.status === 401 ? 'Invalid email or password.' : result.message);
      return;
    }

    // Stays pending while navigating. refresh() makes server components re-read the new cookie.
    router.push('/profile');
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4">
      {formError && <FormError>{formError}</FormError>}

      <FormField
        id="email"
        label="Email"
        type="email"
        autoComplete="email"
        required
        error={fieldErrors.email}
      />
      <FormField
        id="password"
        label="Password"
        type="password"
        autoComplete="current-password"
        required
        error={fieldErrors.password}
      />

      <button type="submit" disabled={pending} className={primaryButton}>
        {pending ? 'Signing in…' : 'Log in'}
      </button>

      <p className="text-center text-sm text-slate-400">
        New to DiffCraft?{' '}
        <Link href="/register" className={textLink}>
          Create an account
        </Link>
      </p>
    </form>
  );
}
