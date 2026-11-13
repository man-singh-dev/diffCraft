import {
  test as base,
  expect,
  type BrowserContext,
  type BrowserContextOptions,
  type Page,
} from '@playwright/test';
import { WEB_URL } from '../env';
import { createUser, UserApi, type TestUser } from './api';

const CSP_PATTERN = /Content[- ]Security[- ]Policy|CSP violation/i;

function watchForCspViolations(context: BrowserContext, violations: string[]) {
  const watch = (page: Page) => {
    page.on('console', (message) => {
      if (CSP_PATTERN.test(message.text())) violations.push(`${page.url()}: ${message.text()}`);
    });
  };
  context.pages().forEach(watch);
  context.on('page', watch);
}

// Logged by the page itself too: Chrome's own console text for a violation could change.
const REPORT_CSP_VIOLATIONS = () => {
  document.addEventListener('securitypolicyviolation', (event) => {
    console.error(`CSP violation: ${event.effectiveDirective} blocked ${event.blockedURI}`);
  });
};

interface Fixtures {
  cspViolations: string[];
  newUser: (displayName: string) => Promise<TestUser>;
  openAs: (user: TestUser) => Promise<Page>;
  apiAs: (user: TestUser) => Promise<UserApi>;
}

export const test = base.extend<Fixtures>({
  cspViolations: [
    // eslint-disable-next-line no-empty-pattern -- Playwright reads fixture dependencies from this pattern.
    async ({}, use) => {
      const violations: string[] = [];
      await use(violations);
      expect(violations, 'Content Security Policy violations').toEqual([]);
    },
    { auto: true },
  ],

  context: async ({ context, cspViolations }, use) => {
    await context.addInitScript(REPORT_CSP_VIOLATIONS);
    watchForCspViolations(context, cspViolations);
    await use(context);
  },

  newUser: async ({ playwright }, use) => {
    await use((displayName) => createUser(playwright, displayName));
  },

  openAs: async ({ browser, cspViolations }, use, testInfo) => {
    const contexts: BrowserContext[] = [];
    const { viewport, deviceScaleFactor, colorScheme, userAgent } = testInfo.project.use;
    const options: BrowserContextOptions = {
      viewport,
      deviceScaleFactor,
      colorScheme,
      userAgent,
      baseURL: WEB_URL,
    };
    await use(async (user) => {
      const context = await browser.newContext({ ...options, storageState: user.storageState });
      contexts.push(context);
      await context.addInitScript(REPORT_CSP_VIOLATIONS);
      watchForCspViolations(context, cspViolations);
      return context.newPage();
    });
    await Promise.all(contexts.map((context) => context.close()));
  },

  apiAs: async ({ playwright }, use) => {
    const apis: UserApi[] = [];
    await use(async (user) => {
      const api = await UserApi.as(playwright, user);
      apis.push(api);
      return api;
    });
    await Promise.all(apis.map((api) => api.dispose()));
  },
});

export { expect };
