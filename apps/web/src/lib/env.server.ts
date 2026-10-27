// This module must only ever be imported on the server.
// The `server-only` package enforces that: if this file is accidentally
// imported in a Client Component or an API route edge runtime, Next.js
// will throw a build-time error.
import 'server-only';

import { formatZodIssues } from '@diffcraft/shared';
import { z } from 'zod';

const EnvSchema = z.object({
  // Keep this default in sync with next.config.ts (the /api rewrite), which can't import this file.
  API_URL: z.url().default('http://localhost:4000'),
});

const result = EnvSchema.safeParse(process.env);

if (!result.success) {
  throw new Error(`Invalid server environment:\n${formatZodIssues(result.error.issues)}`);
}

export const env = result.data;
export type Env = typeof result.data;
