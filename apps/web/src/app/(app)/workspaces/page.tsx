import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { FormError } from '@/components/form-field';
import { PageCard } from '@/components/page-card';
import { RoleBadge } from '@/components/role-badge';
import { getWorkspaces } from '@/lib/api.server';
import { CreateWorkspaceForm } from './create-workspace-form';

export const metadata: Metadata = { title: 'Workspaces · DiffCraft' };

export default async function WorkspacesPage() {
  const result = await getWorkspaces();
  if (!result.ok && result.status === 401) redirect('/login');

  return (
    <PageCard wide title="Workspaces" description="The teams you review code with.">
      <section aria-labelledby="your-workspaces" className="space-y-3">
        <h2 id="your-workspaces" className="text-sm font-semibold text-slate-200">
          Your workspaces
        </h2>
        {!result.ok ? (
          <FormError>Couldn&apos;t load your workspaces. Please try again in a moment.</FormError>
        ) : result.data.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-700 p-6 text-center text-sm text-slate-400">
            You aren&apos;t in any workspaces yet. Create one below, or ask a teammate to add you.
          </p>
        ) : (
          <ul className="divide-y divide-slate-800 rounded-xl border border-slate-800">
            {result.data.map((workspace) => (
              <li key={workspace.id}>
                <Link
                  href={`/workspaces/${workspace.id}`}
                  className="flex items-center justify-between gap-4 px-4 py-3 transition hover:bg-slate-800/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-violet-400"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-slate-100">
                      {workspace.name}
                    </span>
                    <span className="block truncate font-mono text-xs text-slate-500">
                      {workspace.slug}
                    </span>
                  </span>
                  <RoleBadge role={workspace.role} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="create-workspace" className="space-y-3">
        <h2 id="create-workspace" className="text-sm font-semibold text-slate-200">
          Create a workspace
        </h2>
        <CreateWorkspaceForm />
      </section>
    </PageCard>
  );
}
