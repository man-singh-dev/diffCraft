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
