import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { LocalTime } from '@/components/local-time';
import { PageCard } from '@/components/page-card';
import { getCurrentUser } from '@/lib/auth.server';

export const metadata: Metadata = { title: 'Profile · DiffCraft' };

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
          <dd className="flex min-w-0 items-center gap-2">
            <span className="truncate font-mono text-slate-200">{user.email}</span>
            {user.emailVerified ? (
              <span className="shrink-0 rounded-full border border-emerald-800/60 bg-emerald-950/40 px-2 py-0.5 text-xs font-medium text-emerald-300">
                Verified
              </span>
            ) : (
              <span className="shrink-0 rounded-full border border-amber-800/60 bg-amber-950/40 px-2 py-0.5 text-xs font-medium text-amber-300">
                Not verified
              </span>
            )}
          </dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-slate-500">Member since</dt>
          <dd className="text-slate-200">
            <LocalTime iso={user.createdAt} dateOnly />
          </dd>
        </div>
      </dl>
    </PageCard>
  );
}
