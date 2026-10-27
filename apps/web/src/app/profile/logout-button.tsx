'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { FormError } from '@/components/form-field';
import { secondaryButton } from '@/components/styles';
import { logout } from '@/lib/api-client';

export function LogoutButton() {
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
    <div className="space-y-3">
      {error && <FormError>{error}</FormError>}
      <button type="button" onClick={handleClick} disabled={pending} className={secondaryButton}>
        {pending ? 'Logging out…' : 'Log out'}
      </button>
    </div>
  );
}
