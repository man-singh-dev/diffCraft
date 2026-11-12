import { Writable } from 'node:stream';
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { loggerOptions, truncateIp } from './logger.js';

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
  it('redacts passwords, tokens, cookies and authorization headers', async () => {
    const { app, output } = captureLogs();

    app.log.info({ password: 'pw-top-secret', body: { password: 'pw-nested-secret' } }, 'body');
    app.log.info({ token: 'verify-top-secret', body: { token: 'verify-nested-secret' } }, 'token');
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
      'verify-top-secret',
      'verify-nested-secret',
    ]) {
      expect(logged).not.toContain(secret);
    }
    expect(logged).toContain('[REDACTED]');
  });

  it('logs a request with its client address truncated', async () => {
    const { app, output } = captureLogs();
    app.get('/x', async () => 'ok');
    await app.inject({ url: '/x', remoteAddress: '203.0.113.77' });
    await app.close();
    expect(output()).toContain('"remoteAddress":"203.0.113.x"');
    expect(output()).not.toContain('203.0.113.77');
  });
});

describe('truncateIp', () => {
  it('drops the host part of IPv4 and IPv6 addresses', () => {
    expect(truncateIp('198.51.100.23')).toBe('198.51.100.x');
    expect(truncateIp('::ffff:198.51.100.23')).toBe('198.51.100.x');
    expect(truncateIp('2001:db8:85a3:8d3:1319:8a2e:370:7348')).toBe('2001:db8:85a3::x');
    expect(truncateIp('not-an-ip')).toBe('invalid');
  });
});
