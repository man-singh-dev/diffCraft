import type { FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import fp from 'fastify-plugin';
import { AppError } from '../../errors.js';
import { findSessionUser, SESSION_COOKIE_NAME, type SessionUser } from './session.js';
declare module 'fastify' {
  interface FastifyRequest {
    user: SessionUser | null;
  }
}
export class UnauthenticatedError extends AppError {
  constructor() {
    super(401, 'unauthenticated', 'Authentication required.');
  }
}
export const requestUserPlugin = fp(
  async (app) => {
    app.decorateRequest('user', null);
  },
  { name: 'request-user' },
);

/**
 * preHandler for routes that need a logged-in user: cookie → session → request.user.
 * A missing, unknown or expired session is a 401.
 */
export const requireAuth: preHandlerAsyncHookHandler = async (request) => {
  const token = request.cookies[SESSION_COOKIE_NAME];
  if (!token) throw new UnauthenticatedError();
  const user = await findSessionUser(request.server.db, token);
  if (!user) throw new UnauthenticatedError();
  request.user = user;
};

/** request.user in a route behind requireAuth. Throws (401) if requireAuth didn't run. */
export function authUser(request: FastifyRequest): SessionUser {
  if (!request.user) throw new UnauthenticatedError();
  return request.user;
}
