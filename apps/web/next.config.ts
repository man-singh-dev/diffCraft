import path from 'path';
import { loadEnvConfig } from '@next/env';
import type { NextConfig } from 'next';
const repoRoot = path.resolve(import.meta.dirname, '../..');
loadEnvConfig(repoRoot);

// Same default as src/lib/env.server.ts (which can't be imported here: it is server-only).
const apiUrl = (process.env.API_URL ?? 'http://localhost:4000').replace(/\/+$/, '');

const nextConfig: NextConfig = {
  transpilePackages: ['@diffcraft/shared'],
  // The browser only calls relative /api/...; one origin means no CORS and the session cookie belongs to the web app.
  rewrites() {
    return [{ source: '/api/:path*', destination: `${apiUrl}/api/:path*` }];
  },
  // Also as a header (not only the page's meta tag): the token in the URL must never leak via Referer.
  headers() {
    return [
      {
        source: '/verify-email',
        headers: [{ key: 'Referrer-Policy', value: 'no-referrer' }],
      },
    ];
  },
};
export default nextConfig;
