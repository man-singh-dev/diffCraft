import { formatZodIssues } from '@diffcraft/shared';
import { z } from 'zod';

const port = z.coerce.number().int().min(1).max(65535);
const blankAsUnset = (value: unknown) => (value === '' ? undefined : value);
const limit = (fallback: number) => z.coerce.number().int().min(1).max(100_000).default(fallback);

export const AI_PROVIDERS = ['openai_compatible', 'fake', 'disabled'] as const;
export type AiProviderName = (typeof AI_PROVIDERS)[number];

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
    // Production only: proxy addresses trusted for X-Forwarded-For (IPs, CIDRs, proxy-addr presets or a hop count).
    TRUST_PROXY: z
      .string()
      .min(1)
      .default('uniquelocal')
      .transform((value) => (/^\d+$/.test(value) ? Number(value) : value)),
    // Shared with the web server, which uses it to vouch for the client IP it forwards.
    WEB_PROXY_SECRET: z.preprocess(blankAsUnset, z.string().min(32).optional()),
    RATE_LIMIT_ENABLED: z.stringbool().default(true),
    RATE_LIMIT_PREFIX: z.string().min(1).default('diffcraft:rl:'),
    RATE_LIMIT_GLOBAL_PER_MINUTE: limit(300),
    RATE_LIMIT_LOGIN_PER_IP_PER_MINUTE: limit(10),
    RATE_LIMIT_LOGIN_PER_EMAIL_PER_15_MINUTES: limit(5),
    RATE_LIMIT_REGISTER_PER_IP_PER_HOUR: limit(5),
    RATE_LIMIT_RESEND_PER_USER_PER_HOUR: limit(5),
    RATE_LIMIT_TICKET_PER_USER_PER_MINUTE: limit(30),
    RATE_LIMIT_ANALYSIS_PER_USER_PER_MINUTE: limit(5),
    RATE_LIMIT_COMMENTS_PER_USER_PER_MINUTE: limit(60),
    // Only read by the test suite; the app itself never connects to it.
    TEST_DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }).optional(),
    MAIL_TRANSPORT: z.enum(['smtp', 'log']).default('smtp'),
    MAIL_SMTP_URL: z.url({ protocol: /^smtps?$/ }).optional(),
    MAIL_FROM: z.string().trim().min(1).optional(),
    REDIS_URL: z.url({ protocol: /^rediss?$/ }).optional(),
    AI_PROVIDER: z.enum(AI_PROVIDERS).optional(),
    AI_BASE_URL: z.preprocess(blankAsUnset, z.url({ protocol: /^https?$/ }).optional()),
    AI_API_KEY: z.preprocess(blankAsUnset, z.string().trim().min(1).optional()),
    AI_MODEL: z.preprocess(blankAsUnset, z.string().trim().min(1).optional()),
    AI_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(256).max(200_000).default(8000),
    AI_MAX_JOBS_PER_WORKSPACE_PER_DAY: z.coerce.number().int().min(1).max(10_000).default(20),
    AI_WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(20).default(1),
    AI_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(600_000).default(60_000),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production' && !env.REDIS_URL) {
      ctx.addIssue({ code: 'custom', path: ['REDIS_URL'], message: 'Required in production' });
    }
    // Without it every request arriving through the web server shares the web server's IP, and per-IP limits lock everyone out together.
    if (env.NODE_ENV === 'production' && env.RATE_LIMIT_ENABLED && !env.WEB_PROXY_SECRET) {
      ctx.addIssue({
        code: 'custom',
        path: ['WEB_PROXY_SECRET'],
        message: 'Required in production while RATE_LIMIT_ENABLED is true',
      });
    }
    // Production must choose on purpose: the fake provider would silently produce made-up findings.
    if (env.NODE_ENV === 'production' && !env.AI_PROVIDER) {
      ctx.addIssue({ code: 'custom', path: ['AI_PROVIDER'], message: 'Required in production' });
    }
    if (env.AI_PROVIDER === 'openai_compatible') {
      for (const key of ['AI_BASE_URL', 'AI_API_KEY', 'AI_MODEL'] as const) {
        if (!env[key]) {
          ctx.addIssue({
            code: 'custom',
            path: [key],
            message: 'Required when AI_PROVIDER=openai_compatible',
          });
        }
      }
    }
    // Outside production, smtp falls back to the local Mailpit; production must name its provider.
    if (env.NODE_ENV !== 'production' || env.MAIL_TRANSPORT !== 'smtp') return;
    for (const key of ['MAIL_SMTP_URL', 'MAIL_FROM'] as const) {
      if (!env[key]) {
        ctx.addIssue({ code: 'custom', path: [key], message: 'Required when MAIL_TRANSPORT=smtp' });
      }
    }
  })
  .transform(({ API_PORT, PORT, MAIL_SMTP_URL, MAIL_FROM, REDIS_URL, AI_PROVIDER, ...rest }) => ({
    ...rest,
    AI_PROVIDER: AI_PROVIDER ?? 'fake',
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
