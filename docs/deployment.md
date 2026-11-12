# Deployment

How the web app, API and database are deployed on Vercel, Render and Neon, and which variables each host needs.

[← Back to README](../README.md)

---

## Deployment

> Status: **Implemented.** The web app, API and database are deployed. Live demo: [diffcraft-three.vercel.app](https://diffcraft-three.vercel.app).

| Part             | Host   | Plan                     |
| ---------------- | ------ | ------------------------ |
| Web (`apps/web`) | Vercel | Hobby (free)             |
| API (`apps/api`) | Render | Free web service         |
| Database         | Neon   | Free plan, PostgreSQL 18 |

### Environment variables (set in each host's dashboard)

| Host   | Variable                   | Notes                                                                                                                                                      |
| ------ | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vercel | `API_URL`                  | The Render service URL. Also needed at build time: the `/api` rewrite is fixed when the app is built, so changing it means a redeploy.                     |
| Vercel | `NEXT_PUBLIC_REALTIME_URL` | The Render service origin (same as `API_URL`, no path) for live updates. Inlined at build time: changing it means a redeploy. Unset: live updates are off. |
| Render | `NODE_ENV`                 | Production mode: `Secure` cookies and trusted proxy headers.                                                                                               |
| Render | `HOST`                     | All interfaces, so Render's proxy can reach the server.                                                                                                    |
| Render | `DATABASE_URL`             | Neon's direct (non-pooled) connection string. Use `sslmode=verify-full`: same checks as `require` today, without pg's deprecation warning.                 |
| Render | `WEB_ORIGIN`               | The Vercel URL. Must match exactly, or the API's origin check rejects logins (preview deployments have other URLs).                                        |
| Render | `LOG_LEVEL`                | Optional.                                                                                                                                                  |
| Render | `DB_POOL_MAX`              | Optional. Keep it within Neon's connection limit.                                                                                                          |
| Render | `TRUST_PROXY`              | Optional (default: private addresses). Check that `request.ip` shows real client IPs after the first deploy.                                               |

Don't set `API_PORT` on Render: the API falls back to the `PORT` Render provides. Neon needs no variables; it supplies `DATABASE_URL`.

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

Migrations run on start because the API is a single free instance. With several instances they would race on every deploy, so the [future architecture](architecture.md#future-architecture-planned) runs them as a separate release step. See also the [current deployment diagram](architecture.md#current-deployment-implemented).

## AI analysis

> Status: **Implemented in the API, not enabled on the live demo** (it needs Redis, which isn't deployed yet). Design: [design/ai-analysis.md](design/ai-analysis.md).

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
