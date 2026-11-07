import fp from 'fastify-plugin';
import type { Mailer } from './mailer.js';

declare module 'fastify' {
  interface FastifyInstance {
    mailer: Mailer;
  }
}

export const mailerPlugin = fp<{ mailer: Mailer }>(
  async (app, { mailer }) => {
    app.decorate('mailer', mailer);
    app.addHook('onClose', async () => {
      mailer.close?.();
    });
  },
  { name: 'mailer' },
);
