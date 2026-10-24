import { Writable } from 'node:stream';
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { loggerOptions } from './logger.js';

function captureLogs() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      lines.push(chunk.toString());
      callback();
    },
  });
  const app = Fastify({ logger: { ...loggerOptions('info'), stream } });
  return { app, output: () => lines.join('') };
}

describe('loggerOptions', () => {
  it('redacts passwords, cookies and authorization headers', async () => {
    const { app, output } = captureLogs();

    app.log.info({ password: 'pw-top-secret', body: { password: 'pw-nested-secret' } }, 'body');
    app.log.info(
      {
        req: { headers: { authorization: 'Bearer token-secret', cookie: 'sid=cookie-secret' } },
        res: { headers: { 'set-cookie': 'sid=set-cookie-secret' } },
      },
      'headers',
    );
    await app.close();

    const logged = output();
    for (const secret of [
      'pw-top-secret',
      'pw-nested-secret',
      'token-secret',
      'cookie-secret',
      'set-cookie-secret',
    ]) {
      expect(logged).not.toContain(secret);
    }
    expect(logged).toContain('[REDACTED]');
  });
});
