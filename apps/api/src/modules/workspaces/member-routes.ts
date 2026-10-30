import {
  AddMemberRequestSchema,
  UpdateMemberRoleRequestSchema,
  type WorkspaceMember,
} from '@diffcraft/shared';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { ValidationError } from '../../errors.js';
import { authUser } from '../auth/require-auth.js';
import {
  addMember,
  changeMemberRole,
  leaveWorkspace,
  listMembers,
  MemberNotFoundError,
  removeMember,
} from './member-service.js';
import { requestWorkspace, requireWorkspaceRole, UUID_PATTERN } from './require-workspace-role.js';

/** :userId from the URL; a malformed id is a 404 before it reaches the database. */
function targetUserId(request: FastifyRequest): string {
  const { userId } = request.params as { userId?: string };
  if (!userId || !UUID_PATTERN.test(userId)) throw new MemberNotFoundError();
  return userId;
}

/** Registered under /:workspaceId/members inside workspaceRoutes, so requireAuth runs first. */
export const memberRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Reply: WorkspaceMember[] }>(
    '/',
    { preHandler: requireWorkspaceRole('viewer') },
    async (request) => listMembers(app.db, requestWorkspace(request).id),
  );

  app.post<{ Reply: WorkspaceMember }>(
    '/',
    { preHandler: requireWorkspaceRole('admin') },
    async (request, reply) => {
      const parsed = AddMemberRequestSchema.safeParse(request.body);
      if (!parsed.success) throw new ValidationError(parsed.error.issues);

      const { id } = requestWorkspace(request);
      const member = await addMember(app.db, id, authUser(request).id, parsed.data);
      return reply.code(201).send(member);
    },
  );

  app.post('/leave', { preHandler: requireWorkspaceRole('viewer') }, async (request, reply) => {
    await leaveWorkspace(app.db, requestWorkspace(request).id, authUser(request).id);
    return reply.code(204).send();
  });

  app.patch<{ Reply: WorkspaceMember }>(
    '/:userId',
    { preHandler: requireWorkspaceRole('admin') },
    async (request) => {
      const userId = targetUserId(request);
      const parsed = UpdateMemberRoleRequestSchema.safeParse(request.body);
      if (!parsed.success) throw new ValidationError(parsed.error.issues);

      const { id } = requestWorkspace(request);
      return changeMemberRole(app.db, id, authUser(request).id, userId, parsed.data.role);
    },
  );

  app.delete('/:userId', { preHandler: requireWorkspaceRole('admin') }, async (request, reply) => {
    const userId = targetUserId(request);
    await removeMember(app.db, requestWorkspace(request).id, authUser(request).id, userId);
    return reply.code(204).send();
  });
};
