import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';
import { API_URL, apiEnv, WEB_PORT, WEB_URL, webEnv } from './env';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const skipBuild = process.env.E2E_SKIP_BUILD === '1';
const ci = Boolean(process.env.CI);

// The installed Google Chrome by default (no browser download); E2E_BROWSER_CHANNEL= (empty) uses Playwright's Chromium.
const channel = process.env.E2E_BROWSER_CHANNEL ?? 'chrome';

const apiCommand = [
  'node e2e/scripts/prepare-db.ts',
  ...(skipBuild ? [] : ['pnpm --filter @diffcraft/api build']),
  'node apps/api/dist/migrate.js',
  'node apps/api/dist/server.js',
].join(' && ');

const webCommand = [
  ...(skipBuild ? [] : ['pnpm --filter @diffcraft/web build']),
  `pnpm --filter @diffcraft/web exec next start -p ${WEB_PORT}`,
].join(' && ');

export default defineConfig({
  testDir: '.',
  fullyParallel: true,
  forbidOnly: ci,
  retries: ci ? 1 : 0,
  workers: ci ? 2 : undefined,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: WEB_URL,
    channel: channel || undefined,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'e2e',
      testDir: './tests',
      use: { ...devices['Desktop Chrome'], channel: channel || undefined },
    },
    {
      name: 'screenshots',
      testDir: './screenshots',
      timeout: 180_000,
      use: {
        ...devices['Desktop Chrome'],
        channel: channel || undefined,
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 2,
        colorScheme: 'dark',
      },
    },
  ],
  webServer: [
    {
      command: apiCommand,
      cwd: repoRoot,
      url: `${API_URL}/ready`,
      env: apiEnv,
      reuseExistingServer: !ci,
      timeout: 240_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      command: webCommand,
      cwd: repoRoot,
      url: WEB_URL,
      env: webEnv,
      reuseExistingServer: !ci,
      timeout: 360_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
  ],
});
