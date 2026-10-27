// Render dynamically on every request so we always get a live health check.
export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { PageCard } from '@/components/page-card';
import { primaryButton, secondaryButton } from '@/components/styles';
import { getApiHealth } from '@/lib/api-health';
import { getCurrentUser } from '@/lib/auth.server';
import { env } from '@/lib/env.server';

export default async function HomePage() {
  const [health, user] = await Promise.all([getApiHealth(env.API_URL), getCurrentUser()]);

  return (
    <PageCard
      title="DiffCraft"
      description="Collaborative Code Review and AI-Assisted Debugging Platform"
    >
      {/* API Status */}
      <div className="space-y-3">
        <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">API Status</p>

        {health.ok ? (
          <div className="space-y-2 rounded-xl border border-emerald-800/50 bg-emerald-950/40 p-4">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-emerald-400" />
              <span className="text-sm font-medium text-emerald-400">Operational</span>
            </div>
            <dl className="space-y-1 text-xs text-slate-400">
              <div className="flex justify-between">
                <dt className="text-slate-500">Uptime</dt>
                <dd className="font-mono">{health.data.uptimeSeconds.toFixed(1)}s</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">Timestamp</dt>
                <dd className="font-mono">{health.data.timestamp}</dd>
              </div>
            </dl>
          </div>
        ) : (
          <div className="space-y-2 rounded-xl border border-red-800/50 bg-red-950/40 p-4">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-red-400" />
              <span className="text-sm font-medium text-red-400">Unreachable</span>
            </div>
            <p className="text-xs text-slate-400">
              <span className="text-slate-500">Reason: </span>
              {health.reason}
            </p>
          </div>
        )}
      </div>

      {/* Account */}
      {user ? (
        <Link href="/profile" className={primaryButton}>
          Go to your profile
        </Link>
      ) : (
        <div className="flex gap-3">
          <Link href="/login" className={secondaryButton}>
            Log in
          </Link>
          <Link href="/register" className={primaryButton}>
            Sign up
          </Link>
        </div>
      )}
    </PageCard>
  );
}
