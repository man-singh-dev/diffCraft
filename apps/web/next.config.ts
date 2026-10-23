import path from 'path';
import { loadEnvConfig } from '@next/env';
import type { NextConfig } from 'next';

// Load the repo-root .env so that shared variables (API_URL, etc.) are available
// without duplicating them into apps/web/.env.
// loadEnvConfig() is a no-op for files that don't exist, so this is safe on a
// fresh clone or in CI where the root .env is absent.
const repoRoot = path.resolve(import.meta.dirname, '../..');
loadEnvConfig(repoRoot);

const nextConfig: NextConfig = {
  // @diffcraft/shared ships raw TypeScript source (no build step).
  // Next.js must transpile it before bundling.
  transpilePackages: ['@diffcraft/shared'],
};

export default nextConfig;
