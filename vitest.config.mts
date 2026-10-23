import { existsSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

// Each app/package is its own Vitest project (using its own config if present).
// Vitest errors with "No projects were found" if the globs match nothing (even an
// empty array), and `passWithNoTests` doesn't cover that case. So only register
// globs whose parent directory exists, and omit `projects` entirely if none do.
const projects = ['apps', 'packages'].filter((dir) => existsSync(dir)).map((dir) => `${dir}/*`);

export default defineConfig({
  test: {
    ...(projects.length > 0 && { projects }),
    // Keep `pnpm test` green while there are no tests yet.
    passWithNoTests: true,
  },
});
