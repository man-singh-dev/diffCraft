'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { FormError } from '@/components/form-field';
import { PageCard } from '@/components/page-card';
import { ResendVerification } from '@/components/resend-verification';
import { primaryButton, secondaryButton, textLink } from '@/components/styles';
import { verifyEmail } from '@/lib/api-client';

export type VerifyPhase =
  | { kind: 'idle' }
  | { kind: 'confirming' }
  | { kind: 'success' }
  | { kind: 'error'; message: string };

export const INVALID_LINK_MESSAGE = 'This verification link is invalid or has expired.';

export function VerifyEmailForm({ token, loggedIn }: { token: string | null; loggedIn: boolean }) {
  const router = useRouter();
  // Kept in state: the token is removed from the URL, and a refresh then renders this with token null.
  const [initialToken] = useState(token);
  const [phase, setPhase] = useState<VerifyPhase>(
    token ? { kind: 'idle' } : { kind: 'error', message: INVALID_LINK_MESSAGE },
  );

  async function handleConfirm() {
    if (!initialToken) return;
    setPhase({ kind: 'confirming' });
    window.history.replaceState(null, '', window.location.pathname);

    const result = await verifyEmail(initialToken);
    if (!result.ok) {
      setPhase({ kind: 'error', message: result.message });
      return;
    }
    setPhase({ kind: 'success' });
    if (loggedIn) router.refresh();
  }

  return <VerifyEmailView phase={phase} loggedIn={loggedIn} onConfirm={handleConfirm} />;
}

export function VerifyEmailView({
  phase,
  loggedIn,
  onConfirm,
}: {
  phase: VerifyPhase;
  loggedIn: boolean;
  onConfirm: () => void;
}) {
  if (phase.kind === 'success') {
    return (
      <PageCard
        title="Your email is verified"
        description="Thanks for confirming your email address."
      >
        <Link href={loggedIn ? '/workspaces' : '/login'} className={primaryButton}>
          {loggedIn ? 'Continue' : 'Log in'}
        </Link>
      </PageCard>
    );
  }

  if (phase.kind === 'error') {
    return (
      <PageCard title="We couldn't verify your email" description="The link didn't work.">
        <FormError>{phase.message}</FormError>
        {loggedIn ? (
          <ResendVerification buttonClassName={secondaryButton} />
        ) : (
          <p className="text-center text-sm text-slate-400">
            <Link href="/login" className={textLink}>
              Log in to get a new link
            </Link>
          </p>
        )}
      </PageCard>
    );
  }

  return (
    <PageCard
      title="Confirm your email address"
      description="Press the button to finish verifying your DiffCraft account."
    >
      <button
        type="button"
        onClick={onConfirm}
        disabled={phase.kind === 'confirming'}
        className={primaryButton}
      >
        {phase.kind === 'confirming' ? 'Confirming…' : 'Confirm'}
      </button>
    </PageCard>
  );
}
