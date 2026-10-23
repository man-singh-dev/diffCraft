// Render dynamically on every request so we always get a live health check.
export const dynamic = 'force-dynamic';

import { env } from '@/lib/env.server';
import { getApiHealth } from '@/lib/api-health';

export default async function HomePage() {
  const health = await getApiHealth(fetch, env.API_URL);

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-16">
      <div className="w-full max-w-md space-y-6 rounded-2xl border border-slate-800 bg-slate-900 p-8 shadow-2xl">
        {/* Header */}
        <div className="space-y-2">
          <h1 className="bg-gradient-to-r from-violet-400 to-indigo-400 bg-clip-text text-3xl font-bold tracking-tight text-transparent">
            DiffCraft
          </h1>
          <p className="text-sm leading-relaxed text-slate-400">
            Collaborative Code Review and AI-Assisted Debugging Platform
          </p>
        </div>

        {/* Divider */}
        <div className="h-px bg-slate-800" />

        {/* API Status */}
        <div className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">
            API Status
          </p>

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
      </div>
    </main>
  );
}
