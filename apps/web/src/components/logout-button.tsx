'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { logout } from '@/lib/api-client';

export function LogoutButton({ className }: { className: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setPending(true);
    setError(null);
    const result = await logout();
    if (!result.ok) {
      // Still logged in: going to /login would only bounce back here.
      setPending(false);
      setError(result.message);
      return;
    }
    router.push('/login');
    router.refresh();
  }

  return (
    <span className="inline-flex items-center gap-2">
      {error && (
        <span role="alert" className="text-xs text-red-400">
          {error}
        </span>
      )}
      <button type="button" onClick={handleClick} disabled={pending} className={className}>
        {pending ? 'Logging out…' : 'Log out'}
      </button>
    </span>
  );
}
