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

| Host   | Variable       | Notes                                                                                                                                      |
| ------ | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Vercel | `API_URL`      | The Render service URL. Also needed at build time: the `/api` rewrite is fixed when the app is built, so changing it means a redeploy.     |
| Render | `NODE_ENV`     | Production mode: `Secure` cookies and trusted proxy headers.                                                                               |
| Render | `HOST`         | All interfaces, so Render's proxy can reach the server.                                                                                    |
| Render | `DATABASE_URL` | Neon's direct (non-pooled) connection string. Use `sslmode=verify-full`: same checks as `require` today, without pg's deprecation warning. |
| Render | `WEB_ORIGIN`   | The Vercel URL. Must match exactly, or the API's origin check rejects logins (preview deployments have other URLs).                        |
| Render | `LOG_LEVEL`    | Optional.                                                                                                                                  |
| Render | `DB_POOL_MAX`  | Optional. Keep it within Neon's connection limit.                                                                                          |
| Render | `TRUST_PROXY`  | Optional (default: private addresses). Check that `request.ip` shows real client IPs after the first deploy.                               |

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
