import {
  LoginRequestSchema,
  type PublicUser,
  RegisterRequestSchema,
  type ResendVerificationResponse,
  VerifyEmailRequestSchema,
  type VerifyEmailResponse,
} from '@diffcraft/shared';
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
import {
  sendVerificationEmail,
  startResend,
  VerificationEmailFailedError,
  verifyEmail,
} from './verification.js';

export interface AuthRoutesOptions {
  secureCookies: boolean;
  webOrigin: string;
}
export const authRoutes: FastifyPluginAsync<AuthRoutesOptions> = async (
  app,
  { secureCookies, webOrigin },
) => {
  const cookieOptions = sessionCookieOptions(secureCookies);

  async function endSession(token: string) {
    const ended = await deleteSession(app.db, token);
    if (ended) await app.realtime.revokeSessions(ended.userId, [ended.id]);
  }

  app.post<{ Reply: PublicUser }>(
    '/register',
    { preHandler: app.limit('register-ip') },
    async (request, reply) => {
      const parsed = RegisterRequestSchema.safeParse(request.body);
      if (!parsed.success) throw new ValidationError(parsed.error.issues);

      const { user, verificationToken } = await registerUser(app.db, parsed.data);
      // After the commit, so an email never points to a user that was rolled back. A failure is logged; the user can resend.
      await sendVerificationEmail(app.mailer, request.log, {
        webOrigin,
        userId: user.id,
        email: user.email,
        token: verificationToken,
      });
      return reply.code(201).send(user);
    },
  );

  app.post<{ Reply: VerifyEmailResponse }>('/verify-email', async (request) => {
    const parsed = VerifyEmailRequestSchema.safeParse(request.body);
    if (!parsed.success) throw new ValidationError(parsed.error.issues);

    await verifyEmail(app.db, parsed.data.token);
    return { verified: true };
  });

  app.post<{ Reply: ResendVerificationResponse }>(
    '/resend-verification',
    { preHandler: [requireAuth, app.limit('resend-user')] },
    async (request) => {
      const user = authUser(request);
      const result = await startResend(app.db, user.id);
      if (result.alreadyVerified) return { alreadyVerified: true };

      const sent = await sendVerificationEmail(app.mailer, request.log, {
        webOrigin,
        userId: user.id,
        email: result.email,
        token: result.token,
      });
      if (!sent) throw new VerificationEmailFailedError();
      return { alreadyVerified: false };
    },
  );

  app.post<{ Reply: PublicUser }>(
    '/login',
    { preHandler: [app.limit('login-ip'), app.limit('login-email')] },
    async (request, reply) => {
      const parsed = LoginRequestSchema.safeParse(request.body);
      if (!parsed.success) throw new ValidationError(parsed.error.issues);

      const user = await verifyCredentials(app.db, parsed.data, request.log);

      // Session fixation defence: always issue a new session on login, and drop the old one if sent.
      const previousToken = request.cookies[SESSION_COOKIE_NAME];
      if (previousToken) await endSession(previousToken);
      const { token } = await createSession(app.db, user.id);

      reply.setCookie(SESSION_COOKIE_NAME, token, cookieOptions);
      return toPublicUser(user);
    },
  );

  app.post('/logout', async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE_NAME];
    if (token) await endSession(token);

    reply.clearCookie(SESSION_COOKIE_NAME, cookieOptions);
    return reply.code(204).send();
  });

  app.get<{ Reply: PublicUser }>('/me', { preHandler: requireAuth }, async (request) =>
    toPublicUser(authUser(request)),
  );
};
