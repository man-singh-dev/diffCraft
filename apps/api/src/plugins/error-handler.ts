import type { ErrorResponse } from '@diffcraft/shared';
import type { FastifyError } from 'fastify';
import fp from 'fastify-plugin';
import { AppError } from '../errors.js';

// Codes for client errors raised by Fastify itself (malformed JSON, wrong content type, ...).
const CLIENT_ERROR_CODES: Record<number, string> = {
  400: 'bad_request',
  404: 'not_found',
  405: 'method_not_allowed',
  413: 'payload_too_large',
  415: 'unsupported_media_type',
  429: 'rate_limited',
};

/**
 * Makes every error response match ErrorResponseSchema. AppErrors are sent as they are;
 * Fastify's own 4xx errors get a stable code; anything else is logged and becomes a
 * generic 500, so internal details never reach the client.
 */
export const errorHandlerPlugin = fp(
  async (app) => {
    app.setErrorHandler<FastifyError>((error, request, reply) => {
      if (error instanceof AppError) {
        const body: ErrorResponse = {
          error: {
            code: error.code,
            message: error.message,
            ...(error.details !== undefined && { details: error.details }),
          },
        };
        return reply.code(error.statusCode).send(body);
      }

      const statusCode = error.statusCode ?? 500;
      if (statusCode >= 400 && statusCode < 500) {
        const body: ErrorResponse = {
          error: { code: CLIENT_ERROR_CODES[statusCode] ?? 'bad_request', message: error.message },
        };
        return reply.code(statusCode).send(body);
      }

      request.log.error({ err: error }, 'unhandled error');
      const body: ErrorResponse = {
        error: { code: 'internal_error', message: 'An unexpected error occurred.' },
      };
      return reply.code(500).send(body);
    });

    app.setNotFoundHandler((request, reply) => {
      const body: ErrorResponse = {
        error: { code: 'not_found', message: `Route ${request.method} ${request.url} not found.` },
      };
      return reply.code(404).send(body);
    });
  },
  { name: 'error-handler' },
);
