import { z } from 'zod';

const ConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  WEB_ORIGIN: z.url().default('http://localhost:3000'),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  // Only read by the test suite (migrations + DB tests); the app itself never connects to it.
  TEST_DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }).optional(),
});

export type Config = z.infer<typeof ConfigSchema>;

/**
 * Validates environment variables and returns a typed config.
 * On failure, throws an error listing each invalid variable and the reason.
 * Values are never included, since env vars may hold secrets.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = ConfigSchema.safeParse(env);
  if (result.success) return result.data;

  const details = result.error.issues
    .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('\n');
  throw new Error(`Invalid environment configuration:\n${details}`);
}
