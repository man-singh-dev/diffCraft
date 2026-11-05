import type { FastifyServerOptions } from 'fastify';
import type { Config } from './config.js';

type LoggerOptions = Exclude<FastifyServerOptions['logger'], boolean | undefined>;

// Redacts secrets wherever they might be logged; `*.x` covers one level down (e.g. a logged request body).
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
