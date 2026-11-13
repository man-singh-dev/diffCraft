import type { RealtimeTicketResponse } from '@diffcraft/shared';
import type { FastifyPluginAsync } from 'fastify';
import { authSessionId, authUser, requireAuth } from '../auth/require-auth.js';
import { issueTicket, TICKET_TTL_SECONDS } from './ticket.js';

export const realtimeRoutes: FastifyPluginAsync = async (app) => {
  app.post<{ Reply: RealtimeTicketResponse }>(
    '/ticket',
    { preHandler: [requireAuth, app.limit('ticket-user')] },
    async (request, reply) => {
      const ticket = await issueTicket(app.redis, {
        userId: authUser(request).id,
        sessionId: authSessionId(request),
      });
      reply.header('cache-control', 'no-store');
      return { ticket, expiresInSeconds: TICKET_TTL_SECONDS };
    },
  );
};
