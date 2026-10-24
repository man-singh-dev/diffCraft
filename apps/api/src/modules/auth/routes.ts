import { type PublicUser, RegisterRequestSchema } from '@diffcraft/shared';
import type { FastifyPluginAsync } from 'fastify';
import { ValidationError } from '../../errors.js';
import { registerUser } from './service.js';

/** Registered under the /api/v1/auth prefix. Errors are shaped by the global error handler. */
export const authRoutes: FastifyPluginAsync = async (app) => {
  app.post<{ Reply: PublicUser }>('/register', async (request, reply) => {
    const parsed = RegisterRequestSchema.safeParse(request.body);
    if (!parsed.success) throw new ValidationError(parsed.error.issues);

    const user = await registerUser(app.db, parsed.data);
    return reply.code(201).send(user);
  });
};
