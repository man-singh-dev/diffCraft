import {
  CreateWorkspaceRequestSchema,
  UpdateWorkspaceRequestSchema,
  type Workspace,
} from '@diffcraft/shared';
import type { FastifyPluginAsync } from 'fastify';
import { ValidationError } from '../../errors.js';
import { authUser, requireAuth } from '../auth/require-auth.js';
import {
  requestWorkspace,
  requireWorkspaceRole,
  WorkspaceNotFoundError,
} from './require-workspace-role.js';
import {
  createWorkspace,
  deleteWorkspace,
  getWorkspace,
  listWorkspacesForUser,
  renameWorkspace,
} from './service.js';

export const workspaceRoutes: FastifyPluginAsync = async (app) => {
  // Hooks run in order, so requireWorkspaceRole (route preHandler) always sees request.user.
  app.addHook('preHandler', requireAuth);

  app.post<{ Reply: Workspace }>('/', async (request, reply) => {
    const parsed = CreateWorkspaceRequestSchema.safeParse(request.body);
    if (!parsed.success) throw new ValidationError(parsed.error.issues);

    const workspace = await createWorkspace(app.db, authUser(request).id, parsed.data);
    return reply.code(201).send(workspace);
  });

  app.get<{ Reply: Workspace[] }>('/', async (request) =>
    listWorkspacesForUser(app.db, authUser(request).id),
  );

  app.get<{ Reply: Workspace }>(
    '/:workspaceId',
    { preHandler: requireWorkspaceRole('viewer') },
    async (request) => {
      const { id, role } = requestWorkspace(request);
      const workspace = await getWorkspace(app.db, id, role);
      if (!workspace) throw new WorkspaceNotFoundError();
      return workspace;
    },
  );

  app.patch<{ Reply: Workspace }>(
    '/:workspaceId',
    { preHandler: requireWorkspaceRole('admin') },
    async (request) => {
      const parsed = UpdateWorkspaceRequestSchema.safeParse(request.body);
      if (!parsed.success) throw new ValidationError(parsed.error.issues);

      const { id, role } = requestWorkspace(request);
      const workspace = await renameWorkspace(app.db, id, parsed.data.name, role);
      if (!workspace) throw new WorkspaceNotFoundError();
      return workspace;
    },
  );

  app.delete(
    '/:workspaceId',
    { preHandler: requireWorkspaceRole('owner') },
    async (request, reply) => {
      await deleteWorkspace(app.db, requestWorkspace(request).id);
      return reply.code(204).send();
    },
  );
};
