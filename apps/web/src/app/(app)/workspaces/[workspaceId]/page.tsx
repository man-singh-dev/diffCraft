import { canManageMember, hasAtLeastRole, WORKSPACE_ROLES } from '@diffcraft/shared';
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { FormError } from '@/components/form-field';
import { PageCard } from '@/components/page-card';
import { RoleBadge } from '@/components/role-badge';
import { getMembers, getWorkspace } from '@/lib/api.server';
import { getCurrentUser } from '@/lib/auth.server';
import { AddMemberForm } from './add-member-form';
import { DeleteWorkspace } from './delete-workspace';
import { LeaveWorkspace } from './leave-workspace';
import { MemberControls } from './member-controls';
import { RenameWorkspaceForm } from './rename-workspace-form';

export const metadata: Metadata = { title: 'Workspace · DiffCraft' };

// UTC so the date doesn't depend on the server's time zone.
const joinedDate = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeZone: 'UTC' });

const sectionHeading = 'text-sm font-semibold text-slate-200';

export default async function WorkspacePage(props: PageProps<'/workspaces/[workspaceId]'>) {
  const { workspaceId } = await props.params;
  const [user, workspace, members] = await Promise.all([
    getCurrentUser(),
    getWorkspace(workspaceId),
    getMembers(workspaceId),
  ]);

  if (!user || [workspace, members].some((r) => !r.ok && r.status === 401)) redirect('/login');
  // 404 also covers "not a member", so other people's workspace ids reveal nothing.
  if ([workspace, members].some((r) => !r.ok && r.status === 404)) notFound();
  if (!workspace.ok || !members.ok) {
    return (
      <PageCard title="Workspace" description="Something went wrong.">
        <FormError>Couldn&apos;t load this workspace. Please try again in a moment.</FormError>
      </PageCard>
    );
  }

  const { role } = workspace.data;
  // The API enforces all of this; the UI only hides what would be refused.
  const addableRoles = WORKSPACE_ROLES.filter((r) => canManageMember(role, null, r));

  return (
    <PageCard wide title={workspace.data.name} description="Workspace details and members.">
      <dl className="space-y-3 rounded-xl border border-slate-800 bg-slate-950/40 p-4 text-sm">
        <div className="flex justify-between gap-4">
          <dt className="text-slate-500">Slug</dt>
          <dd className="truncate font-mono text-slate-200">{workspace.data.slug}</dd>
        </div>
        <div className="flex items-center justify-between gap-4">
          <dt className="text-slate-500">Your role</dt>
          <dd>
            <RoleBadge role={role} />
          </dd>
        </div>
      </dl>

      <section aria-labelledby="members" className="space-y-3">
        <h2 id="members" className={sectionHeading}>
          Members ({members.data.length})
        </h2>
        <ul className="divide-y divide-slate-800 rounded-xl border border-slate-800">
          {members.data.map((member) => {
            const isYou = member.userId === user.id;
            const manageable = !isYou && canManageMember(role, member.role);
            return (
              <li
                key={member.userId}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-100">
                    {member.displayName}
                    {isYou && <span className="ml-2 text-xs text-slate-500">(you)</span>}
                  </p>
                  <p className="truncate font-mono text-xs text-slate-400">{member.email}</p>
                  <p className="text-xs text-slate-500">
                    Joined{' '}
                    <time dateTime={member.joinedAt}>
                      {joinedDate.format(new Date(member.joinedAt))}
                    </time>
                  </p>
                </div>
                {manageable ? (
                  <MemberControls
                    // Remount when the role changes, so the select starts from the saved role.
                    key={`${member.userId}:${member.role}`}
                    workspaceId={workspace.data.id}
                    member={member}
                    roles={WORKSPACE_ROLES.filter((r) => canManageMember(role, member.role, r))}
                  />
                ) : (
                  <RoleBadge role={member.role} />
                )}
              </li>
            );
          })}
        </ul>
      </section>

      {hasAtLeastRole(role, 'admin') && (
        <section aria-labelledby="add-member" className="space-y-3">
          <h2 id="add-member" className={sectionHeading}>
            Add a member
          </h2>
          <AddMemberForm workspaceId={workspace.data.id} roles={addableRoles} />
        </section>
      )}

      {hasAtLeastRole(role, 'admin') && (
        <section aria-labelledby="rename" className="space-y-3">
          <h2 id="rename" className={sectionHeading}>
            Rename
          </h2>
          <RenameWorkspaceForm workspaceId={workspace.data.id} name={workspace.data.name} />
        </section>
      )}

      <section aria-labelledby="leave" className="space-y-3">
        <h2 id="leave" className={sectionHeading}>
          Leave workspace
        </h2>
        <LeaveWorkspace workspaceId={workspace.data.id} />
      </section>

      {role === 'owner' && (
        <section aria-labelledby="danger-zone" className="space-y-3">
          <h2 id="danger-zone" className="text-sm font-semibold text-red-300">
            Delete workspace
          </h2>
          <DeleteWorkspace workspaceId={workspace.data.id} name={workspace.data.name} />
        </section>
      )}
    </PageCard>
  );
}
