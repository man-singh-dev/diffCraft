import { z } from 'zod';

export const WORKSPACE_ROLES = ['owner', 'admin', 'member', 'viewer'] as const;
export const WorkspaceRoleSchema = z.enum(WORKSPACE_ROLES);
export type WorkspaceRole = z.infer<typeof WorkspaceRoleSchema>;

export const CreateWorkspaceRequestSchema = z.object({
  name: z.string().trim().min(1).max(80),
});
export type CreateWorkspaceRequest = z.infer<typeof CreateWorkspaceRequestSchema>;

/** A workspace as seen by one user: `role` is that user's role in it. */
export const WorkspaceSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  slug: z.string(),
  createdAt: z.iso.datetime(),
  role: WorkspaceRoleSchema,
});
export type Workspace = z.infer<typeof WorkspaceSchema>;
