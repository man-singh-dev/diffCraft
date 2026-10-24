import { existsSync } from 'node:fs';
import { defineConfig } from 'drizzle-kit';
// drizzle-kit doesn't read .env files. Load the root one (the db:* scripts run from
// apps/api); variables already set in the shell take precedence.
if (existsSync('../../.env')) process.loadEnvFile('../../.env');

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set (add it to the root .env or the shell).');

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema/index.ts',
  out: './drizzle',
  dbCredentials: { url },
  strict: true,
  verbose: true,
});
