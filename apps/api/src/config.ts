import { formatZodIssues } from '@diffcraft/shared';
import { z } from 'zod';

const port = z.coerce.number().int().min(1).max(65535);

const ConfigSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    // 127.0.0.1 locally; production sets 0.0.0.0 so the host's proxy can reach the server.
    HOST: z.string().min(1).default('127.0.0.1'),
    API_PORT: port.optional(),
    // Set by hosts like Render. API_PORT wins if both are set.
    PORT: port.optional(),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    WEB_ORIGIN: z.url().default('http://localhost:3000'),
    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    DB_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
    // Production only: proxy addresses to trust for X-Forwarded-For, as comma-separated IPs,
    // CIDRs or proxy-addr presets. Render's proxy reaches the API from a private address.
    TRUST_PROXY: z.string().min(1).default('uniquelocal'),
    // Only read by the test suite (migrations + DB tests); the app itself never connects to it.
    TEST_DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }).optional(),
  })
  .transform(({ API_PORT, PORT, ...rest }) => ({ ...rest, API_PORT: API_PORT ?? PORT ?? 4000 }));

export type Config = z.output<typeof ConfigSchema>;

/**
 * Validates environment variables and returns a typed config.
 * On failure, throws an error listing each invalid variable and the reason.
 * Values are never included, since env vars may hold secrets.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = ConfigSchema.safeParse(env);
  if (result.success) return result.data;

  throw new Error(`Invalid environment configuration:\n${formatZodIssues(result.error.issues)}`);
}
