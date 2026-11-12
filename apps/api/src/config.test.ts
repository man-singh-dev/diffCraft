import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

const DATABASE_URL = 'postgresql://user:pass@localhost:5432/db';
const REDIS_URL = 'rediss://default:r3dis-secret@redis.example.com:6380';
const PRODUCTION = { DATABASE_URL, NODE_ENV: 'production', AI_PROVIDER: 'disabled' } as const;
const PROD_BASE = { ...PRODUCTION, REDIS_URL, MAIL_TRANSPORT: 'log' } as const;

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
      REDIS_URL: 'redis://localhost:6379',
      AI_PROVIDER: 'fake',
      AI_MAX_OUTPUT_TOKENS: 8000,
      AI_MAX_JOBS_PER_WORKSPACE_PER_DAY: 20,
      AI_WORKER_CONCURRENCY: 1,
      AI_TIMEOUT_MS: 60000,
    });
  });

  describe('redis', () => {
    it('requires REDIS_URL in production, naming it without values', () => {
      expect(() =>
        loadConfig({ DATABASE_URL, NODE_ENV: 'production', MAIL_TRANSPORT: 'log' }),
      ).toThrow(/REDIS_URL/);
      expect(loadConfig({ ...PRODUCTION, MAIL_TRANSPORT: 'log', REDIS_URL }).REDIS_URL).toBe(
        REDIS_URL,
      );
    });

    it.each(['http://localhost:6379', 'not a url', 'rediss://default:r3dis-secret@'])(
      'rejects %j without printing it',
      (value) => {
        expect(() => loadConfig({ DATABASE_URL, REDIS_URL: value })).toThrow(/REDIS_URL/);
        try {
          loadConfig({ DATABASE_URL, REDIS_URL: value });
        } catch (error) {
          expect(String(error)).not.toContain('r3dis-secret');
        }
      },
    );
  });

  describe('mail', () => {
    it('requires MAIL_SMTP_URL and MAIL_FROM for smtp in production, naming them without values', () => {
      expect(() => loadConfig({ DATABASE_URL, NODE_ENV: 'production', REDIS_URL })).toThrow(
        /MAIL_SMTP_URL[\s\S]*MAIL_FROM/,
      );
      const smtpUrl = 'smtps://user:s3cret@smtp.example.com:465';
      expect(() =>
        loadConfig({ DATABASE_URL, NODE_ENV: 'production', REDIS_URL, MAIL_SMTP_URL: smtpUrl }),
      ).toThrow(/MAIL_FROM/);
      try {
        loadConfig({ DATABASE_URL, NODE_ENV: 'production', REDIS_URL, MAIL_SMTP_URL: smtpUrl });
      } catch (error) {
        expect(String(error)).not.toContain('s3cret');
      }
      expect(
        loadConfig({
          ...PRODUCTION,
          REDIS_URL,
          MAIL_SMTP_URL: smtpUrl,
          MAIL_FROM: 'DiffCraft <noreply@example.com>',
        }),
      ).toMatchObject({ MAIL_TRANSPORT: 'smtp', MAIL_SMTP_URL: smtpUrl });
    });

    it('accepts MAIL_TRANSPORT=log in production without SMTP settings', () => {
      expect(loadConfig({ ...PRODUCTION, REDIS_URL, MAIL_TRANSPORT: 'log' }).MAIL_TRANSPORT).toBe(
        'log',
      );
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

  describe('ai', () => {
    const OPENAI = {
      AI_PROVIDER: 'openai_compatible',
      AI_BASE_URL: 'https://api.groq.com/openai/v1',
      AI_API_KEY: 'test-super-secret-key',
      AI_MODEL: 'openai/gpt-oss-120b',
    } as const;

    it('defaults to the fake provider outside production', () => {
      expect(loadConfig({ DATABASE_URL, NODE_ENV: 'test' }).AI_PROVIDER).toBe('fake');
    });

    it('requires AI_PROVIDER in production', () => {
      expect(() => loadConfig({ ...PROD_BASE, AI_PROVIDER: undefined })).toThrow(/AI_PROVIDER/);
      expect(loadConfig(PROD_BASE).AI_PROVIDER).toBe('disabled');
    });

    it('requires the base URL, key and model for openai_compatible, never printing the key', () => {
      expect(() => loadConfig({ DATABASE_URL, AI_PROVIDER: 'openai_compatible' })).toThrow(
        /AI_BASE_URL[\s\S]*AI_API_KEY[\s\S]*AI_MODEL/,
      );
      try {
        loadConfig({ DATABASE_URL, ...OPENAI, AI_MODEL: '' });
      } catch (error) {
        expect(String(error)).toMatch(/AI_MODEL/);
        expect(String(error)).not.toContain('super-secret');
      }
      expect(loadConfig({ ...PROD_BASE, ...OPENAI })).toMatchObject({
        AI_PROVIDER: 'openai_compatible',
        AI_MODEL: 'openai/gpt-oss-120b',
      });
    });

    it('reads the numeric limits', () => {
      expect(
        loadConfig({
          DATABASE_URL,
          AI_MAX_OUTPUT_TOKENS: '16000',
          AI_MAX_JOBS_PER_WORKSPACE_PER_DAY: '5',
          AI_WORKER_CONCURRENCY: '2',
          AI_TIMEOUT_MS: '30000',
        }),
      ).toMatchObject({
        AI_MAX_OUTPUT_TOKENS: 16000,
        AI_MAX_JOBS_PER_WORKSPACE_PER_DAY: 5,
        AI_WORKER_CONCURRENCY: 2,
        AI_TIMEOUT_MS: 30000,
      });
    });

    it.each([
      { AI_PROVIDER: 'anthropic' },
      { AI_BASE_URL: 'ftp://example.com' },
      { AI_WORKER_CONCURRENCY: '0' },
      { AI_TIMEOUT_MS: 'soon' },
    ])('rejects %j', (env) => {
      expect(() => loadConfig({ DATABASE_URL, ...env })).toThrow(/AI_/);
    });
  });
});
