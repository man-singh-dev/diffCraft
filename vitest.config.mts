import { existsSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

// Vitest errors with "No projects were found" if globs match nothing (passWithNoTests doesn't cover it), so only existing dirs are registered.
const projects = ['apps', 'packages'].filter((dir) => existsSync(dir)).map((dir) => `${dir}/*`);

export default defineConfig({
  test: {
    ...(projects.length > 0 && { projects }),
    // Keep `pnpm test` green while there are no tests yet.
    passWithNoTests: true,
  },
});
