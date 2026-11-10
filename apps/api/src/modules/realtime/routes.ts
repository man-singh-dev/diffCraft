import type { RealtimeTicketResponse } from '@diffcraft/shared';
import type { FastifyPluginAsync } from 'fastify';
import { authUser, requireAuth } from '../auth/require-auth.js';
import { issueTicket, TICKET_TTL_SECONDS } from './ticket.js';

export const realtimeRoutes: FastifyPluginAsync = async (app) => {
  app.post<{ Reply: RealtimeTicketResponse }>(
    '/ticket',
    { preHandler: requireAuth },
    async (request, reply) => {
      const ticket = await issueTicket(app.redis, authUser(request).id);
      reply.header('cache-control', 'no-store');
      return { ticket, expiresInSeconds: TICKET_TTL_SECONDS };
    },
  );
};
