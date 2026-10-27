import fp from 'fastify-plugin';
import { AppError } from '../errors.js';

const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export class ForbiddenOriginError extends AppError {
  constructor() {
    super(403, 'forbidden_origin', 'Request origin is not allowed.');
  }
}

export interface CsrfPluginOptions {
  webOrigin: string;
}
export const csrfPlugin = fp<CsrfPluginOptions>(
  async (app, { webOrigin }) => {
    // Normalised, so a configured "http://localhost:3000/" still matches the header.
    const allowedOrigin = new URL(webOrigin).origin;

    app.addHook('onRequest', async (request) => {
      if (!STATE_CHANGING_METHODS.has(request.method)) return;
      const origin = request.headers.origin;
      if (origin !== undefined && origin !== allowedOrigin) throw new ForbiddenOriginError();
    });
  },
  { name: 'csrf' },
);
