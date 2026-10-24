import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

const DATABASE_URL = 'postgresql://user:pass@localhost:5432/db';

describe('loadConfig', () => {
  it('applies defaults when only required vars are set', () => {
    expect(loadConfig({ DATABASE_URL })).toEqual({
      NODE_ENV: 'development',
      API_PORT: 4000,
      LOG_LEVEL: 'info',
      WEB_ORIGIN: 'http://localhost:3000',
      DATABASE_URL,
    });
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

  it('throws on an invalid port', () => {
    expect(() => loadConfig({ DATABASE_URL, API_PORT: '70000' })).toThrow(/API_PORT/);
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
