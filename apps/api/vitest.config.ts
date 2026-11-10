import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { defineConfig } from 'vitest/config';

// Vitest doesn't read .env files: take the test URLs from the root .env; a value already set (e.g. CI) wins.
const rootEnv = fileURLToPath(new URL('../../.env', import.meta.url));
if (existsSync(rootEnv)) {
  const fromFile = parseEnv(readFileSync(rootEnv, 'utf8'));
  for (const key of ['TEST_DATABASE_URL', 'TEST_REDIS_URL', 'REDIS_URL'] as const) {
    const value = fromFile[key];
    if (!process.env[key] && value) process.env[key] = value;
  }
}

export default defineConfig({
  test: {
    name: 'api',
    globalSetup: ['./src/test/global-setup.ts'],
  },
});
