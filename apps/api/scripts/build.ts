import { readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';

const apiRoot = path.resolve(import.meta.dirname, '..');
const pkg = JSON.parse(readFileSync(path.join(apiRoot, 'package.json'), 'utf8')) as {
  dependencies: Record<string, string>;
};

// npm deps stay external (@node-rs/argon2 loads a native binary); workspace packages are raw TS, so they're bundled.
const external = Object.entries(pkg.dependencies)
  .filter(([, version]) => !version.startsWith('workspace:'))
  .map(([name]) => name);

rmSync(path.join(apiRoot, 'dist'), { recursive: true, force: true });

const result = await build({
  absWorkingDir: apiRoot,
  entryPoints: ['src/server.ts', 'src/migrate.ts'],
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  external,
  sourcemap: true,
  metafile: true,
  logLevel: 'info',
});

// Guard: a package missing from "dependencies" (e.g. a devDependency) would otherwise be bundled silently.
const bundledNpmFiles = Object.keys(result.metafile.inputs).filter((input) =>
  input.includes('node_modules'),
);
if (bundledNpmFiles.length > 0) {
  console.error(
    'These npm files were bundled; add their package to "dependencies":\n' +
      bundledNpmFiles.map((input) => `  - ${input}`).join('\n'),
  );
  process.exit(1);
}
