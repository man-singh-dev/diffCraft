import { createHash, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import fp from 'fastify-plugin';

declare module 'fastify' {
  interface FastifyRequest {
    clientIp: string;
  }
}

export const CLIENT_IP_HEADER = 'x-diffcraft-client-ip';
export const PROXY_SECRET_HEADER = 'x-diffcraft-proxy-secret';

const digest = (value: string) => createHash('sha256').update(value).digest();

export interface ClientIpPluginOptions {
  proxySecret: string | undefined;
}

// request.ip comes from trustProxy (Render's proxy); the web server's header is believed only with the shared secret,
// because anyone can send it.
export const clientIpPlugin = fp<ClientIpPluginOptions>(
  async (app, { proxySecret }) => {
    const expected = proxySecret ? digest(proxySecret) : null;
    app.decorateRequest('clientIp', '');
    app.addHook('onRequest', async (request) => {
      request.clientIp = request.ip;
      if (!expected) return;
      const secret = request.headers[PROXY_SECRET_HEADER];
      const forwarded = request.headers[CLIENT_IP_HEADER];
      if (typeof secret !== 'string' || typeof forwarded !== 'string') return;
      if (!timingSafeEqual(digest(secret), expected)) return;
      if (isIP(forwarded) !== 0) request.clientIp = forwarded;
    });
  },
  { name: 'client-ip' },
);
