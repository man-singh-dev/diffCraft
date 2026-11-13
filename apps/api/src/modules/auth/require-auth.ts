import type { FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import fp from 'fastify-plugin';
import { AppError } from '../../errors.js';
import { findSession, SESSION_COOKIE_NAME, type SessionUser } from './session.js';
declare module 'fastify' {
  interface FastifyRequest {
    user: SessionUser | null;
    sessionId: string | null;
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
    app.decorateRequest('sessionId', null);
  },
  { name: 'request-user' },
);

export const requireAuth: preHandlerAsyncHookHandler = async (request) => {
  const token = request.cookies[SESSION_COOKIE_NAME];
  if (!token) throw new UnauthenticatedError();
  const { db, realtime } = request.server;
  const session = await findSession(db, token, (ended) =>
    realtime.revokeSessions(ended.userId, [ended.id]),
  );
  if (!session) throw new UnauthenticatedError();
  request.user = session.user;
  request.sessionId = session.id;
};

export function authUser(request: FastifyRequest): SessionUser {
  if (!request.user) throw new UnauthenticatedError();
  return request.user;
}

export function authSessionId(request: FastifyRequest): string {
  if (!request.sessionId) throw new UnauthenticatedError();
  return request.sessionId;
}
