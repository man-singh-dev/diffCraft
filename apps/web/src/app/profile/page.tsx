import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { PageCard } from '@/components/page-card';
import { getCurrentUser } from '@/lib/auth.server';
import { LogoutButton } from './logout-button';

export const metadata: Metadata = { title: 'Profile · DiffCraft' };

// UTC so the date doesn't depend on the server's time zone.
const memberSince = new Intl.DateTimeFormat('en', { dateStyle: 'long', timeZone: 'UTC' });

export default async function ProfilePage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  return (
    <PageCard title={user.displayName} description="Your DiffCraft profile.">
      <dl className="space-y-3 rounded-xl border border-slate-800 bg-slate-950/40 p-4 text-sm">
        <div className="flex justify-between gap-4">
          <dt className="text-slate-500">Display name</dt>
          <dd className="truncate text-slate-200">{user.displayName}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-slate-500">Email</dt>
          <dd className="truncate font-mono text-slate-200">{user.email}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-slate-500">Member since</dt>
          <dd className="text-slate-200">
            <time dateTime={user.createdAt}>{memberSince.format(new Date(user.createdAt))}</time>
          </dd>
        </div>
      </dl>

      <LogoutButton />
    </PageCard>
  );
}
