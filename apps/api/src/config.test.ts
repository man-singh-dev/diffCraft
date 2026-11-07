import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

const DATABASE_URL = 'postgresql://user:pass@localhost:5432/db';

describe('loadConfig', () => {
  it('applies defaults when only required vars are set', () => {
    expect(loadConfig({ DATABASE_URL })).toEqual({
      NODE_ENV: 'development',
      HOST: '127.0.0.1',
      API_PORT: 4000,
      LOG_LEVEL: 'info',
      WEB_ORIGIN: 'http://localhost:3000',
      DATABASE_URL,
      DB_POOL_MAX: 10,
      TRUST_PROXY: 'uniquelocal',
      MAIL_TRANSPORT: 'smtp',
      MAIL_SMTP_URL: 'smtp://localhost:1025',
      MAIL_FROM: 'DiffCraft <noreply@localhost>',
    });
  });

  describe('mail', () => {
    it('requires MAIL_SMTP_URL and MAIL_FROM for smtp in production, naming them without values', () => {
      expect(() => loadConfig({ DATABASE_URL, NODE_ENV: 'production' })).toThrow(
        /MAIL_SMTP_URL[\s\S]*MAIL_FROM/,
      );
      const smtpUrl = 'smtps://user:s3cret@smtp.example.com:465';
      expect(() =>
        loadConfig({ DATABASE_URL, NODE_ENV: 'production', MAIL_SMTP_URL: smtpUrl }),
      ).toThrow(/MAIL_FROM/);
      try {
        loadConfig({ DATABASE_URL, NODE_ENV: 'production', MAIL_SMTP_URL: smtpUrl });
      } catch (error) {
        expect(String(error)).not.toContain('s3cret');
      }
      expect(
        loadConfig({
          DATABASE_URL,
          NODE_ENV: 'production',
          MAIL_SMTP_URL: smtpUrl,
          MAIL_FROM: 'DiffCraft <noreply@example.com>',
        }),
      ).toMatchObject({ MAIL_TRANSPORT: 'smtp', MAIL_SMTP_URL: smtpUrl });
    });

    it('accepts MAIL_TRANSPORT=log in production without SMTP settings', () => {
      expect(
        loadConfig({ DATABASE_URL, NODE_ENV: 'production', MAIL_TRANSPORT: 'log' }).MAIL_TRANSPORT,
      ).toBe('log');
    });

    it.each([
      { MAIL_TRANSPORT: 'sendmail' },
      { MAIL_SMTP_URL: 'http://localhost:1025' },
      { MAIL_SMTP_URL: 'not a url' },
      { MAIL_FROM: '   ' },
    ])('rejects %j', (env) => {
      expect(() => loadConfig({ DATABASE_URL, ...env })).toThrow(/MAIL_/);
    });
  });

  it('reads HOST', () => {
    expect(loadConfig({ DATABASE_URL, HOST: '0.0.0.0' }).HOST).toBe('0.0.0.0');
  });

  describe('port', () => {
    it('uses PORT (set by Render) when API_PORT is not set', () => {
      expect(loadConfig({ DATABASE_URL, PORT: '10000' }).API_PORT).toBe(10000);
    });

    it('prefers API_PORT over PORT', () => {
      expect(loadConfig({ DATABASE_URL, API_PORT: '4001', PORT: '10000' }).API_PORT).toBe(4001);
    });

    it('does not expose PORT separately', () => {
      expect(loadConfig({ DATABASE_URL, PORT: '10000' })).not.toHaveProperty('PORT');
    });

    it('throws on an invalid API_PORT', () => {
      expect(() => loadConfig({ DATABASE_URL, API_PORT: '70000' })).toThrow(/API_PORT/);
    });

    it('names PORT when PORT is invalid', () => {
      // "- PORT:" so a message about API_PORT wouldn't match.
      expect(() => loadConfig({ DATABASE_URL, PORT: 'abc' })).toThrow(/- PORT:/);
    });
  });

  it('reads DB_POOL_MAX and rejects values below 1', () => {
    expect(loadConfig({ DATABASE_URL, DB_POOL_MAX: '3' }).DB_POOL_MAX).toBe(3);
    expect(() => loadConfig({ DATABASE_URL, DB_POOL_MAX: '0' })).toThrow(/DB_POOL_MAX/);
  });

  it('reads TRUST_PROXY', () => {
    expect(loadConfig({ DATABASE_URL, TRUST_PROXY: '10.0.0.0/8' }).TRUST_PROXY).toBe('10.0.0.0/8');
    expect(() => loadConfig({ DATABASE_URL, TRUST_PROXY: '' })).toThrow(/TRUST_PROXY/);
  });

  it('throws when DATABASE_URL is missing', () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
  });

  it('throws when DATABASE_URL is not a postgres URL', () => {
    expect(() => loadConfig({ DATABASE_URL: 'mysql://localhost/db' })).toThrow(/DATABASE_URL/);
  });

  it('accepts an optional TEST_DATABASE_URL', () => {
    const TEST_DATABASE_URL = 'postgres://user:pass@localhost:5432/db_test';
    expect(loadConfig({ DATABASE_URL, TEST_DATABASE_URL }).TEST_DATABASE_URL).toBe(
      TEST_DATABASE_URL,
    );
  });

  it('throws on an invalid WEB_ORIGIN', () => {
    expect(() => loadConfig({ DATABASE_URL, WEB_ORIGIN: 'not a url' })).toThrow(/WEB_ORIGIN/);
  });

  it('does not include the invalid value in the error', () => {
    expect(() => loadConfig({ DATABASE_URL: 'secret-value' })).toThrow(
      expect.objectContaining({ message: expect.not.stringContaining('secret-value') }),
    );
  });
});
