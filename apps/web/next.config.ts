import path from 'path';
import { loadEnvConfig } from '@next/env';
import type { NextConfig } from 'next';
const repoRoot = path.resolve(import.meta.dirname, '../..');
loadEnvConfig(repoRoot);

const nextConfig: NextConfig = {
  transpilePackages: ['@diffcraft/shared'],
};
export default nextConfig;
