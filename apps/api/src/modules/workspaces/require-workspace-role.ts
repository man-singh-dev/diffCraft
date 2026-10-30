import { hasAtLeastRole, type WorkspaceRole } from '@diffcraft/shared';
import type { FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import fp from 'fastify-plugin';
import { ForbiddenError, NotFoundError } from '../../errors.js';
import { authUser } from '../auth/require-auth.js';
import { getMembership } from './service.js';

declare module 'fastify' {
  interface FastifyRequest {
    workspace: { id: string; role: WorkspaceRole } | null;
  }
}

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class WorkspaceNotFoundError extends NotFoundError {
  constructor() {
    super('workspace_not_found', 'Workspace not found.');
  }
}

export const requestWorkspacePlugin = fp(
  async (app) => {
    app.decorateRequest('workspace', null);
  },
  { name: 'request-workspace' },
);

/** preHandler for /:workspaceId routes; must run after requireAuth. */
export function requireWorkspaceRole(minimum: WorkspaceRole): preHandlerAsyncHookHandler {
  return async (request) => {
    const { workspaceId } = request.params as { workspaceId?: string };
    // Non-members get the same 404 as a missing workspace (not 403), so ids can't be probed for existence.
    if (!workspaceId || !UUID_PATTERN.test(workspaceId)) throw new WorkspaceNotFoundError();

    const role = await getMembership(request.server.db, workspaceId, authUser(request).id);
    if (!role) throw new WorkspaceNotFoundError();
    if (!hasAtLeastRole(role, minimum)) throw new ForbiddenError();

    request.workspace = { id: workspaceId, role };
  };
}

export function requestWorkspace(request: FastifyRequest): { id: string; role: WorkspaceRole } {
  if (!request.workspace) throw new WorkspaceNotFoundError();
  return request.workspace;
}
