import { LoginRequestSchema, type PublicUser, RegisterRequestSchema } from '@diffcraft/shared';
import type { FastifyPluginAsync } from 'fastify';
import { ValidationError } from '../../errors.js';
import { authUser, requireAuth } from './require-auth.js';
import { registerUser, toPublicUser, verifyCredentials } from './service.js';
import {
  createSession,
  deleteSession,
  SESSION_COOKIE_NAME,
  sessionCookieOptions,
} from './session.js';

export interface AuthRoutesOptions {
  secureCookies: boolean;
}
export const authRoutes: FastifyPluginAsync<AuthRoutesOptions> = async (app, { secureCookies }) => {
  const cookieOptions = sessionCookieOptions(secureCookies);

  app.post<{ Reply: PublicUser }>('/register', async (request, reply) => {
    const parsed = RegisterRequestSchema.safeParse(request.body);
    if (!parsed.success) throw new ValidationError(parsed.error.issues);

    const user = await registerUser(app.db, parsed.data);
    return reply.code(201).send(user);
  });

  app.post<{ Reply: PublicUser }>('/login', async (request, reply) => {
    const parsed = LoginRequestSchema.safeParse(request.body);
    if (!parsed.success) throw new ValidationError(parsed.error.issues);

    const user = await verifyCredentials(app.db, parsed.data, request.log);

    // Session fixation defence: never reuse a session from before login. Always issue a
    // new one, and drop the old one if the browser sent it.
    const previousToken = request.cookies[SESSION_COOKIE_NAME];
    if (previousToken) await deleteSession(app.db, previousToken);
    const { token } = await createSession(app.db, user.id);

    reply.setCookie(SESSION_COOKIE_NAME, token, cookieOptions);
    return toPublicUser(user);
  });

  app.post('/logout', async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE_NAME];
    if (token) await deleteSession(app.db, token);

    reply.clearCookie(SESSION_COOKIE_NAME, cookieOptions);
    return reply.code(204).send();
  });

  app.get<{ Reply: PublicUser }>('/me', { preHandler: requireAuth }, async (request) =>
    toPublicUser(authUser(request)),
  );
};
