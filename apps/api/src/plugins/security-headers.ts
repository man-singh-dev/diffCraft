import helmet from '@fastify/helmet';
import fp from 'fastify-plugin';

export interface SecurityHeadersPluginOptions {
  hsts: boolean;
}

export const securityHeadersPlugin = fp<SecurityHeadersPluginOptions>(
  async (app, { hsts }) => {
    await app.register(helmet, {
      global: true,
      // JSON never needs to load anything or be framed.
      contentSecurityPolicy: {
        useDefaults: false,
        directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
      },
      frameguard: { action: 'deny' },
      referrerPolicy: { policy: 'no-referrer' },
      hsts: hsts ? { maxAge: 31_536_000, includeSubDomains: true } : false,
    });
    // Responses carry per-user data behind a cookie; no shared or browser cache may keep them.
    app.addHook('onSend', async (_request, reply) => {
      if (!reply.hasHeader('cache-control')) reply.header('cache-control', 'no-store');
    });
  },
  { name: 'security-headers' },
);
