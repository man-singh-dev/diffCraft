'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { lineThreadHref } from '@/lib/notifications';
import { useComments } from './comments-provider';

export function ThreadHashRedirect({ filesHref }: { filesHref: string }) {
  const comments = useComments();
  const router = useRouter();
  const threads = comments?.threads;

  useEffect(() => {
    if (!threads) return;
    const handle = () => {
      const href = lineThreadHref(window.location.hash, threads, filesHref);
      if (href) router.replace(href);
    };
    handle();
    window.addEventListener('hashchange', handle);
    return () => window.removeEventListener('hashchange', handle);
  }, [threads, filesHref, router]);

  return null;
}
