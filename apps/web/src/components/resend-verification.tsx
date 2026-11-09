'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { resendVerification } from '@/lib/api-client';
import { DEFAULT_RETRY_AFTER_SECONDS } from '@/lib/email-verification';

type Status =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | { kind: 'sent' }
  | { kind: 'already_verified' }
  | { kind: 'throttled'; until: number }
  | { kind: 'error'; message: string };

const secondsLeft = (until: number) => Math.max(0, Math.ceil((until - Date.now()) / 1000));

export function ResendVerification({ buttonClassName }: { buttonClassName: string }) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [remaining, setRemaining] = useState(0);

  const until = status.kind === 'throttled' ? status.until : null;
  useEffect(() => {
    if (until === null) return;
    // Recomputed from the deadline, not decremented: background tabs throttle timers.
    const tick = () => {
      const left = secondsLeft(until);
      setRemaining(left);
      if (left === 0) setStatus({ kind: 'idle' });
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [until]);

  async function handleClick() {
    setStatus({ kind: 'sending' });
    const result = await resendVerification();
    if (result.ok) {
      if (result.data.alreadyVerified) {
        setStatus({ kind: 'already_verified' });
        router.refresh();
      } else {
        setStatus({ kind: 'sent' });
      }
      return;
    }
    if (result.status === 429) {
      const seconds = result.retryAfterSeconds ?? DEFAULT_RETRY_AFTER_SECONDS;
      setRemaining(seconds);
      setStatus({ kind: 'throttled', until: Date.now() + seconds * 1000 });
    } else if (result.status === 503) {
      setStatus({ kind: 'error', message: "We couldn't send the email. Try again in a minute." });
    } else {
      setStatus({ kind: 'error', message: result.message });
    }
  }

  const throttled = status.kind === 'throttled';
  const label =
    status.kind === 'sending'
      ? 'Sending…'
      : throttled
        ? `Resend in ${remaining} s`
        : 'Resend email';

  return (
    <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={status.kind === 'sending' || throttled || status.kind === 'already_verified'}
        className={buttonClassName}
      >
        {label}
      </button>
      <span role="status" className="text-xs">
        {status.kind === 'sent' && (
          <span className="text-emerald-400">Sent. Check your inbox.</span>
        )}
        {status.kind === 'already_verified' && (
          <span className="text-emerald-400">Your email is already verified.</span>
        )}
        {status.kind === 'error' && <span className="text-red-400">{status.message}</span>}
      </span>
    </span>
  );
}
