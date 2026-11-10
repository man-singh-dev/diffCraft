import { formatZodIssues } from '@diffcraft/shared';
import { z } from 'zod';

const port = z.coerce.number().int().min(1).max(65535);

const ConfigSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    // 127.0.0.1 locally; production sets 0.0.0.0 so the host's proxy can reach the server.
    HOST: z.string().min(1).default('127.0.0.1'),
    API_PORT: port.optional(),
    PORT: port.optional(),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    WEB_ORIGIN: z.url().default('http://localhost:3000'),
    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    DB_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
    // Production only: proxy addresses trusted for X-Forwarded-For (IPs, CIDRs or proxy-addr presets).
    TRUST_PROXY: z.string().min(1).default('uniquelocal'),
    // Only read by the test suite; the app itself never connects to it.
    TEST_DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }).optional(),
    MAIL_TRANSPORT: z.enum(['smtp', 'log']).default('smtp'),
    MAIL_SMTP_URL: z.url({ protocol: /^smtps?$/ }).optional(),
    MAIL_FROM: z.string().trim().min(1).optional(),
    REDIS_URL: z.url({ protocol: /^rediss?$/ }).optional(),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production' && !env.REDIS_URL) {
      ctx.addIssue({ code: 'custom', path: ['REDIS_URL'], message: 'Required in production' });
    }
    // Outside production, smtp falls back to the local Mailpit; production must name its provider.
    if (env.NODE_ENV !== 'production' || env.MAIL_TRANSPORT !== 'smtp') return;
    for (const key of ['MAIL_SMTP_URL', 'MAIL_FROM'] as const) {
      if (!env[key]) {
        ctx.addIssue({ code: 'custom', path: [key], message: 'Required when MAIL_TRANSPORT=smtp' });
      }
    }
  })
  .transform(({ API_PORT, PORT, MAIL_SMTP_URL, MAIL_FROM, REDIS_URL, ...rest }) => ({
    ...rest,
    API_PORT: API_PORT ?? PORT ?? 4000,
    MAIL_SMTP_URL: MAIL_SMTP_URL ?? 'smtp://localhost:1025',
    MAIL_FROM: MAIL_FROM ?? 'DiffCraft <noreply@localhost>',
    REDIS_URL: REDIS_URL ?? 'redis://localhost:6379',
  }));

export type Config = z.output<typeof ConfigSchema>;

/** Errors name each invalid variable but never its value: env vars may hold secrets. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = ConfigSchema.safeParse(env);
  if (result.success) return result.data;

  throw new Error(`Invalid environment configuration:\n${formatZodIssues(result.error.issues)}`);
}
