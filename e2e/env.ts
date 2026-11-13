import { randomBytes } from 'node:crypto';

export const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 3100);
export const API_PORT = Number(process.env.E2E_API_PORT ?? 4100);
export const WEB_URL = `http://localhost:${WEB_PORT}`;
export const API_URL = `http://localhost:${API_PORT}`;
export const MAILPIT_URL = process.env.E2E_MAILPIT_URL ?? 'http://localhost:8025';

export const DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? 'postgresql://diffcraft:diffcraft@localhost:5432/diffcraft_e2e';
export const REDIS_URL = process.env.E2E_REDIS_URL ?? 'redis://localhost:6379/2';
const SMTP_URL = process.env.E2E_SMTP_URL ?? 'smtp://localhost:1025';

/** The per-email login limit that the rate-limit test runs into. */
export const LOGIN_ATTEMPTS_PER_EMAIL = 5;

// Generated per run: it only has to be the same in the web server and the API.
const webProxySecret = process.env.E2E_WEB_PROXY_SECRET ?? randomBytes(32).toString('base64url');
process.env.E2E_WEB_PROXY_SECRET = webProxySecret;

const UNLIMITED = '100000';

export const apiEnv: Record<string, string> = {
  // Not production: production cookies are Secure, which plain-http test requests may not send back.
  NODE_ENV: 'development',
  HOST: '127.0.0.1',
  API_PORT: String(API_PORT),
  LOG_LEVEL: process.env.E2E_LOG_LEVEL ?? 'warn',
  WEB_ORIGIN: WEB_URL,
  DATABASE_URL,
  REDIS_URL,
  MAIL_TRANSPORT: 'smtp',
  MAIL_SMTP_URL: SMTP_URL,
  MAIL_FROM: 'DiffCraft E2E <noreply@localhost>',
  AI_PROVIDER: 'fake',
  WEB_PROXY_SECRET: webProxySecret,
  // On, so the rate-limit test sees a real 429; every limit except login per email is out of reach.
  RATE_LIMIT_ENABLED: 'true',
  RATE_LIMIT_PREFIX: 'diffcraft:e2e:rl:',
  RATE_LIMIT_GLOBAL_PER_MINUTE: UNLIMITED,
  RATE_LIMIT_LOGIN_PER_IP_PER_MINUTE: UNLIMITED,
  RATE_LIMIT_LOGIN_PER_EMAIL_PER_15_MINUTES: String(LOGIN_ATTEMPTS_PER_EMAIL),
  RATE_LIMIT_REGISTER_PER_IP_PER_HOUR: UNLIMITED,
  RATE_LIMIT_RESEND_PER_USER_PER_HOUR: UNLIMITED,
  RATE_LIMIT_TICKET_PER_USER_PER_MINUTE: UNLIMITED,
  RATE_LIMIT_ANALYSIS_PER_USER_PER_MINUTE: UNLIMITED,
  RATE_LIMIT_COMMENTS_PER_USER_PER_MINUTE: UNLIMITED,
  AI_MAX_JOBS_PER_WORKSPACE_PER_DAY: '1000',
};

export const webEnv: Record<string, string> = {
  API_URL,
  NEXT_PUBLIC_REALTIME_URL: API_URL,
  WEB_PROXY_SECRET: webProxySecret,
  // Its own build directory, so an e2e build never replaces a regular one.
  NEXT_DIST_DIR: '.next-e2e',
};
