import type { FastifyServerOptions } from 'fastify';
import type { Config } from './config.js';

type LoggerOptions = Exclude<FastifyServerOptions['logger'], boolean | undefined>;

/**
 * Pino options for the API. Secrets are redacted wherever they might be logged:
 * request headers, response cookies, and any `password` / `passwordHash` field
 * at the top level or one level down (e.g. a logged request body).
 */
export function loggerOptions(level: Config['LOG_LEVEL']): LoggerOptions {
  return {
    level,
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'res.headers["set-cookie"]',
        'password',
        'passwordHash',
        '*.password',
        '*.passwordHash',
      ],
      censor: '[REDACTED]',
    },
  };
}
