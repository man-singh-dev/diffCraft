# Deployment

How the web app, API and database are deployed on Vercel, Render and Neon, and which variables each host needs.

[← Back to README](../README.md)

---

## Deployment

> Status: **Implemented.** The web app, the API (with the AI worker and the outbox relay in the same process), Redis and the database are deployed. Live demo: [diffcraft-three.vercel.app](https://diffcraft-three.vercel.app).

| Part             | Host   | Plan                     |
| ---------------- | ------ | ------------------------ |
| Web (`apps/web`) | Vercel | Hobby (free)             |
| API (`apps/api`) | Render | Free web service         |
| Database         | Neon   | Free plan, PostgreSQL 18 |
| Redis            | Render | Key Value                |
| AI provider      | Groq   | Free API tier            |

### Environment variables (set in each host's dashboard)

| Host   | Variable                   | Notes                                                                                                                                                                                                                                                            |
| ------ | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vercel | `API_URL`                  | The Render service URL. Also needed at build time: the `/api` rewrite is fixed when the app is built, so changing it means a redeploy.                                                                                                                           |
| Vercel | `NEXT_PUBLIC_REALTIME_URL` | The Render service origin (same as `API_URL`, no path) for live updates. Inlined at build time: changing it means a redeploy. Unset: live updates are off.                                                                                                       |
| Render | `NODE_ENV`                 | Production mode: `Secure` cookies and trusted proxy headers.                                                                                                                                                                                                     |
| Render | `HOST`                     | All interfaces, so Render's proxy can reach the server.                                                                                                                                                                                                          |
| Render | `DATABASE_URL`             | Neon's direct (non-pooled) connection string. Use `sslmode=verify-full`: same checks as `require` today, without pg's deprecation warning.                                                                                                                       |
| Render | `REDIS_URL`                | **Required in production.** The Render Key Value internal connection URL (`redis://` or `rediss://`). Used for realtime tickets, the Socket.IO adapter, the AI queue and rate limits. Set its eviction policy to `noeviction` (see [AI analysis](#ai-analysis)). |
| Render | `MAIL_TRANSPORT`           | `log` until an email provider is set up: verification links go to the server log. `smtp` requires `MAIL_SMTP_URL` and `MAIL_FROM`.                                                                                                                               |
| Render | `WEB_ORIGIN`               | The Vercel URL. Must match exactly, or the API's origin check rejects logins (preview deployments have other URLs).                                                                                                                                              |
| Render | `LOG_LEVEL`                | Optional.                                                                                                                                                                                                                                                        |
| Render | `DB_POOL_MAX`              | Optional. Keep it within Neon's connection limit.                                                                                                                                                                                                                |
| Render | `TRUST_PROXY`              | Optional (default: private addresses). IPs, CIDRs, presets or a hop count; never `true`. See [security](security.md#the-real-client-ip).                                                                                                                         |
| Both   | `WEB_PROXY_SECRET`         | **Required on Render in production** (while rate limiting is on), and set to the **same value** on Vercel. At least 32 characters; generate with `openssl rand -base64 32`. See below.                                                                           |

Don't set `API_PORT` on Render: the API falls back to the `PORT` Render provides. Neon needs no variables; it supplies `DATABASE_URL`.

### Rate limiting

Limits are shared through Redis (`REDIS_URL`), so all API instances count together. Every variable is optional on Render.

| Variable                                    | Default         | Limit                                                                |
| ------------------------------------------- | --------------- | -------------------------------------------------------------------- |
| `RATE_LIMIT_ENABLED`                        | `true`          | `false` turns all limits off (the API logs a warning in production). |
| `RATE_LIMIT_PREFIX`                         | `diffcraft:rl:` | Redis key prefix; give each environment sharing one Redis its own.   |
| `RATE_LIMIT_GLOBAL_PER_MINUTE`              | 300             | Every route except `/health` and `/ready`, per client IP.            |
| `RATE_LIMIT_LOGIN_PER_IP_PER_MINUTE`        | 10              | `POST /auth/login` per client IP.                                    |
| `RATE_LIMIT_LOGIN_PER_EMAIL_PER_15_MINUTES` | 5               | `POST /auth/login` per normalized email, across IPs.                 |
| `RATE_LIMIT_REGISTER_PER_IP_PER_HOUR`       | 5               | `POST /auth/register` per client IP.                                 |
| `RATE_LIMIT_RESEND_PER_USER_PER_HOUR`       | 5               | `POST /auth/resend-verification` per user.                           |
| `RATE_LIMIT_TICKET_PER_USER_PER_MINUTE`     | 30              | `POST /realtime/ticket` per user.                                    |
| `RATE_LIMIT_ANALYSIS_PER_USER_PER_MINUTE`   | 5               | `POST …/analyses` per user (the daily workspace cap still applies).  |
| `RATE_LIMIT_COMMENTS_PER_USER_PER_MINUTE`   | 60              | New threads and replies together, per user.                          |

**`WEB_PROXY_SECRET`.** The API sees every request from the web app as coming from Vercel's addresses. With the secret, the web server forwards the real client IP and the API believes it. Without it, per-IP limits would count all users as one. Set the same random value in both dashboards and redeploy both. To rotate it, change both and redeploy both: until both have the new value, requests are counted against Vercel's IP. After the first deploy, log in with a wrong password from two networks. Each should get its own 10 attempts.

**Security headers** need no configuration. HSTS is sent only when `NODE_ENV=production`. On a custom domain, `includeSubDomains` applies to every subdomain, so check they all serve HTTPS first.

### API build and start (Render)

pnpm 12 runs through `npx`, not Corepack. `NODE_ENV=development` on the install makes sure devDependencies (esbuild) are installed even though the service sets `NODE_ENV` for production.

```bash
# Build Command
NODE_ENV=development npx --yes pnpm@12.15.0 install --frozen-lockfile && npx --yes pnpm@12.15.0 --filter @diffcraft/api build

# Start Command: apply pending migrations, then start the server
npm --prefix apps/api run start:prod
```

Health check path: `/health`. The build bundles `src/server.ts` and `src/migrate.ts` into `apps/api/dist/` with esbuild; npm dependencies stay external and are installed on the server.

On Vercel, set the project's Root Directory to `apps/web` and the Install Command to `npx --yes pnpm@12.15.0 install --frozen-lockfile` (otherwise Vercel picks pnpm 9 or 10 from the lockfile version, which refuses this repo's `packageManager`). The default `next build` is fine.

Migrations run on start because the API is a single free instance. With several instances they would race on every deploy, so the [multi-instance setup](architecture.md#scaling-beyond-one-instance) would run them as a separate release step. See also the [current deployment diagram](architecture.md#current-deployment-implemented).

## AI analysis

> Status: **Implemented and enabled on the live demo** (Groq through its OpenAI-compatible API, with Redis on Render Key Value). Design: [design/ai-analysis.md](design/ai-analysis.md).

The worker runs inside the API process, so no extra service is needed: each API instance works up to `AI_WORKER_CONCURRENCY` jobs and runs the sweeper.

| Host   | Variable                            | Notes                                                                                              |
| ------ | ----------------------------------- | -------------------------------------------------------------------------------------------------- |
| Render | `AI_PROVIDER`                       | **Required in production**: `openai_compatible`, `disabled` or (for a demo only) `fake`.           |
| Render | `AI_BASE_URL`                       | For `openai_compatible`, e.g. `https://api.groq.com/openai/v1`. Provider table: the design doc.    |
| Render | `AI_API_KEY`                        | For `openai_compatible`. A secret: set it in the dashboard only. The API never logs it.            |
| Render | `AI_MODEL`                          | For `openai_compatible`, e.g. `openai/gpt-oss-120b` on Groq.                                       |
| Render | `AI_MAX_OUTPUT_TOKENS`              | Optional (8000). Keep it generous for reasoning models: a cut-off answer counts as invalid output. |
| Render | `AI_MAX_JOBS_PER_WORKSPACE_PER_DAY` | Optional (20). Caps provider usage per workspace per rolling 24 hours.                             |
| Render | `AI_WORKER_CONCURRENCY`             | Optional (1). Free provider tiers allow only a few requests per minute.                            |
| Render | `AI_TIMEOUT_MS`                     | Optional (60000).                                                                                  |
| Render | `REDIS_URL`                         | Already required in production; BullMQ uses it with its own connections.                           |

**Redis must not evict keys.** BullMQ keeps jobs and locks in Redis, and an eviction policy can silently drop queued jobs. Set `maxmemory-policy noeviction` (many hosted Redis plans default to `volatile-lru` or `allkeys-lru`: change it in the provider's settings). The local Docker Redis has no memory limit, so nothing is evicted there. If a job is lost anyway, the sweeper re-enqueues it from Postgres within a few minutes.

**Free provider tiers.** Groq, Cerebras, OpenRouter (`:free` models) and Gemini have free tiers with low per-minute and per-day limits. DiffCraft makes one call per analysis (two if the answer needs a repair) and retries `429` responses after the provider's `Retry-After`; a wait over 5 minutes fails the job instead. **Free tiers may use prompts for training: don't send private code to them.** Secrets are masked before sending, but the code itself is sent as-is.
