import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { defineConfig } from 'vitest/config';

// Vitest doesn't read .env files. Pick up TEST_DATABASE_URL from the root .env so local
// runs find the test database; a value already set in the shell (e.g. CI) wins.
const rootEnv = fileURLToPath(new URL('../../.env', import.meta.url));
if (!process.env.TEST_DATABASE_URL && existsSync(rootEnv)) {
  const { TEST_DATABASE_URL } = parseEnv(readFileSync(rootEnv, 'utf8'));
  if (TEST_DATABASE_URL) process.env.TEST_DATABASE_URL = TEST_DATABASE_URL;
}

export default defineConfig({
  test: {
    name: 'api',
    globalSetup: ['./src/test/global-setup.ts'],
  },
});
