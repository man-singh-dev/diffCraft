import path from 'path';
import { loadEnvConfig } from '@next/env';
import type { NextConfig } from 'next';
const repoRoot = path.resolve(import.meta.dirname, '../..');
// forceReload: Next.js has already loaded apps/web's (absent) env files, and without it @next/env returns that cached result.
loadEnvConfig(repoRoot, process.env.NODE_ENV !== 'production', undefined, true);

// Same default as src/lib/env.server.ts (which can't be imported here: it is server-only).
const apiUrl = (process.env.API_URL ?? 'http://localhost:4000').replace(/\/+$/, '');

const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR || '.next',
  transpilePackages: ['@diffcraft/shared'],
  // Inlined at build time like the browser bundle's copy: the proxy (CSP connect-src) runs without the root .env loaded above.
  env: { NEXT_PUBLIC_REALTIME_URL: process.env.NEXT_PUBLIC_REALTIME_URL ?? '' },
  // The browser only calls relative /api/...; one origin means no CORS and the session cookie belongs to the web app.
  rewrites() {
    return [{ source: '/api/:path*', destination: `${apiUrl}/api/:path*` }];
  },
  headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          ...(process.env.NODE_ENV === 'production'
            ? [{ key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' }]
            : []),
        ],
      },
      // After the rule above so it wins. Also as a header (not only the page's meta tag): the token in the URL must never leak via Referer.
      {
        source: '/verify-email',
        headers: [{ key: 'Referrer-Policy', value: 'no-referrer' }],
      },
    ];
  },
};
export default nextConfig;
