import type { WorkspaceRole } from '@diffcraft/shared';

const COLORS: Record<WorkspaceRole, string> = {
  owner: 'border-violet-700 bg-violet-950/60 text-violet-200',
  admin: 'border-indigo-700 bg-indigo-950/60 text-indigo-200',
  member: 'border-slate-600 bg-slate-800/60 text-slate-200',
  viewer: 'border-slate-700 bg-slate-900 text-slate-400',
};

export const roleLabel = (role: WorkspaceRole) => role.charAt(0).toUpperCase() + role.slice(1);

export function RoleBadge({ role }: { role: WorkspaceRole }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${COLORS[role]}`}
    >
      {roleLabel(role)}
    </span>
  );
}
