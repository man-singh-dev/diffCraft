import { isIPv4, isIPv6 } from 'node:net';
import type { FastifyRequest, FastifyServerOptions } from 'fastify';
import type { Config } from './config.js';

type LoggerOptions = Exclude<FastifyServerOptions['logger'], boolean | undefined>;

export function truncateIp(ip: string | undefined): string | undefined {
  if (!ip) return ip;
  const mapped = ip.startsWith('::ffff:') ? ip.slice(7) : ip;
  if (isIPv4(mapped)) return `${mapped.split('.').slice(0, 3).join('.')}.x`;
  if (isIPv6(ip)) return `${ip.split(':').slice(0, 3).join(':')}::x`;
  return 'invalid';
}

// Redacts secrets wherever they might be logged; `*.x` covers one level down (e.g. a logged request body).
export function loggerOptions(level: Config['LOG_LEVEL']): LoggerOptions {
  return {
    level,
    serializers: {
      req: (req: FastifyRequest) => ({
        method: req.method,
        url: req.url,
        host: req.host,
        remoteAddress: truncateIp(req.ip),
      }),
    },
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'res.headers["set-cookie"]',
        'password',
        'passwordHash',
        '*.password',
        '*.passwordHash',
        'token',
        '*.token',
        'ticket',
        '*.ticket',
      ],
      censor: '[REDACTED]',
    },
  };
}
