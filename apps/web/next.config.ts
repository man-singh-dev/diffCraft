import path from 'path';
import { loadEnvConfig } from '@next/env';
import type { NextConfig } from 'next';
const repoRoot = path.resolve(import.meta.dirname, '../..');
loadEnvConfig(repoRoot);

// Same default as src/lib/env.server.ts (which can't be imported here: it is server-only).
const apiUrl = (process.env.API_URL ?? 'http://localhost:4000').replace(/\/+$/, '');

const nextConfig: NextConfig = {
  transpilePackages: ['@diffcraft/shared'],
  // The browser only ever calls relative /api/... URLs; the Next server forwards them to the
  // API. To the browser it is all one origin, so there is no CORS and the session cookie is
  // stored for (and sent back to) the web app's own origin.
  rewrites() {
    return [{ source: '/api/:path*', destination: `${apiUrl}/api/:path*` }];
  },
};
export default nextConfig;
