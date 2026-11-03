import { defineConfig } from 'vitest/config';

export default defineConfig({
  // tsconfig.json keeps JSX as is for Next.js ("preserve"); the tests compile it themselves.
  oxc: { jsx: { runtime: 'automatic' } },
  test: {
    name: 'web',
    environment: 'node',
  },
});
