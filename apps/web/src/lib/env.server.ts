// This module must only ever be imported on the server.
// The `server-only` package enforces that: if this file is accidentally
// imported in a Client Component or an API route edge runtime, Next.js
// will throw a build-time error.
import 'server-only';

import { z } from 'zod';

const EnvSchema = z.object({
  API_URL: z.url().default('http://localhost:4000'),
});

const result = EnvSchema.safeParse(process.env);

if (!result.success) {
  const details = result.error.issues
    .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('\n');
  throw new Error(`Invalid server environment:\n${details}`);
}

export const env = result.data;
export type Env = typeof result.data;
