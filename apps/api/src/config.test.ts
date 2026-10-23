import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

describe('loadConfig', () => {
  it('applies defaults when env is empty', () => {
    expect(loadConfig({})).toEqual({
      NODE_ENV: 'development',
      API_PORT: 4000,
      LOG_LEVEL: 'info',
      WEB_ORIGIN: 'http://localhost:3000',
    });
  });

  it('throws on an invalid port', () => {
    expect(() => loadConfig({ API_PORT: '70000' })).toThrow(/API_PORT/);
  });

  it('throws on an invalid WEB_ORIGIN', () => {
    expect(() => loadConfig({ WEB_ORIGIN: 'not a url' })).toThrow(/WEB_ORIGIN/);
  });

  it('does not include the invalid value in the error', () => {
    expect(() => loadConfig({ WEB_ORIGIN: 'secret-value' })).toThrow(
      expect.objectContaining({ message: expect.not.stringContaining('secret-value') }),
    );
  });
});
