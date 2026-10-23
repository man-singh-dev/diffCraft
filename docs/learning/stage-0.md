# Stage 0: Foundation (revision notes)

Short notes on what Stage 0 built, why, what went wrong, and what to revise for interviews.

---

## 1. What we built

**Step 1: Workspace root.** A pnpm workspace with `apps/*` and `packages/*`. Main files: `package.json` (pinned `packageManager: pnpm@12.15.0`, Node `>=24`), `pnpm-workspace.yaml`, `.nvmrc`, `.gitignore`, `.gitattributes` (LF line endings everywhere).

**Step 2: Shared tooling.** One config for the whole repo: `tsconfig.base.json` (strict settings, no `module` setting so each package picks its own), `eslint.config.mjs` (flat config with typescript-eslint and eslint-config-prettier), `.prettierrc`, `.prettierignore`, and `vitest.config.mts` (runs each app/package as a Vitest project).

**Step 3: Shared package.** `packages/shared` exports Zod schemas and the types inferred from them. So far it holds one contract: `HealthResponseSchema` in `src/health.ts`. It is consumed as raw TypeScript (`exports: "./src/index.ts"`), with no build step.

**Step 4: API skeleton.** `apps/api` is a Fastify server. `src/config.ts` validates env vars with Zod, `src/app.ts` has `buildApp()`, `src/server.ts` calls `listen()` and handles SIGINT/SIGTERM, and `src/routes/health.ts` serves `GET /health`. Tests use `app.inject()`. Dev runs with `tsx watch`.

**Step 5: Web skeleton.** `apps/web` is a Next.js 16 App Router app with Tailwind 4. `src/app/page.tsx` is a server component that calls the API's `/health` and validates the response with the shared schema. `src/lib/env.server.ts` validates the server-only `API_URL`. `next.config.ts` loads the root `.env` with `loadEnvConfig`.

**Step 6: Local infrastructure.** `docker-compose.yml` runs Postgres 18 and Redis 8. Both have healthchecks and named volumes, with ports bound to `127.0.0.1`. `infra/postgres/init/01-create-test-db.sql` creates `diffcraft_test`. Root scripts: `infra:up`, `infra:down`, `infra:logs`. No app code connects to them yet.

**Step 7: CI.** `.github/workflows/ci.yml` runs on PRs to `main` and pushes to `main`. Steps: install with `--frozen-lockfile`, then typecheck, lint, format check, test, and build the web app. It has read-only permissions and cancels older runs on the same branch.

---

## 2. Key decisions and why

| Decision                                                                                           | Why                                                                                                                                                                                                                                                                            | Alternative we didn't pick                                                                                                                   |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| **pnpm workspaces monorepo**                                                                       | One clone, one lockfile, one CI run. Shared code is linked locally with `workspace:*`. pnpm is fast, saves disk space and is strict about undeclared dependencies.                                                                                                             | Separate repos would need a published shared package and version bumps on every contract change. Plain npm workspaces are looser and slower. |
| **Shared package as raw TS source**, with `.ts` import extensions and `allowImportingTsExtensions` | No build step and no `dist` getting out of date. Next.js transpiles it (`transpilePackages`) and tsx runs it directly. The `.ts` extensions make the imports resolve under both NodeNext (API) and Bundler (web). This is only allowed because the package has `noEmit: true`. | Compiling the package to `dist` with `tsc` (needs a watch step in dev), or TS project references.                                            |
| **Zod schema as the single source of truth**                                                       | The schema validates at runtime, and `z.infer` derives the TypeScript type from it, so the two can't drift apart.                                                                                                                                                              | Hand-written interfaces plus separate validation code, which easily get out of sync.                                                         |
| **`buildApp()` separate from `listen()`**                                                          | Tests build the app and call `app.inject()` without opening a port. `server.ts` only handles config, listening and shutdown.                                                                                                                                                   | Building and listening in one file, which makes tests need real ports.                                                                       |
| **Fail-fast config validation that never prints values**                                           | A bad env var fails at startup instead of on some later request. Errors list only the variable name and reason, because values may be secrets.                                                                                                                                 | Reading `process.env` lazily wherever it's needed, or logging the whole invalid config.                                                      |
| **`/health` is liveness only; `/ready` in Stage 1**                                                | Liveness answers "is the process alive?" and must not depend on the DB. Otherwise a DB outage would make the orchestrator restart healthy API processes. Readiness (DB and Redis reachable) only makes sense once we connect to them.                                          | One `/health` endpoint that also checks dependencies.                                                                                        |
| **Server-only `API_URL`, not `NEXT_PUBLIC_API_URL`**                                               | The page fetches the API from a server component, so the URL never needs to reach the browser. `NEXT_PUBLIC_*` values are inlined into the client bundle at build time.                                                                                                        | `NEXT_PUBLIC_API_URL` with fetching from the browser.                                                                                        |
| **`loadEnvConfig` from `@next/env` to read the root `.env`**                                       | Next.js only reads `.env` from its own folder (`apps/web`). This loads the shared root file without copying it, and it does nothing if the file is missing (as in CI).                                                                                                         | A duplicate `apps/web/.env`, or a symlink (unreliable on Windows).                                                                           |
| **`next-env.d.ts` git-ignored; typecheck is `next typegen && tsc --noEmit`**                       | Next.js generates and rewrites the file itself, so committing it causes noisy diffs. `next typegen` creates it (and the route types) before `tsc` runs, so typecheck works on a clean clone.                                                                                   | Committing the generated file.                                                                                                               |
| **Postgres 18 volume mounted at `/var/lib/postgresql`; ports on `127.0.0.1`**                      | Postgres 18 images moved `PGDATA` to `/var/lib/postgresql/18/docker`. Mounting at the old `/data` path would not persist data. Binding to localhost keeps the DB off the local network.                                                                                        | Mounting `/var/lib/postgresql/data` (correct only for ≤17), or publishing ports on `0.0.0.0` (the default).                                  |
| **Init script as `.sql`, not `.sh`**                                                               | A `.sh` file checked out with CRLF line endings fails inside the Linux container (`/bin/sh^M`). SQL doesn't care about line endings.                                                                                                                                           | A shell script that runs `psql` and relies on `.gitattributes` being right.                                                                  |
| **CI uses `--frozen-lockfile`; pnpm via `pnpm/action-setup`**                                      | `--frozen-lockfile` fails if the lockfile doesn't match `package.json`, so CI installs exactly what was committed. `pnpm/action-setup@v6` (≥ v6.1.0) supports pnpm 12 and reads the version from `packageManager`.                                                             | Corepack (couldn't run pnpm 12 locally), or a plain `pnpm install` that can quietly change the lockfile.                                     |

---

## 3. Problems we hit and how we fixed them

- **Corepack couldn't run pnpm 12.** `corepack enable` failed to set up `pnpm@12`. Fix: installed pnpm globally with `npm install -g pnpm`. CI uses `pnpm/action-setup` instead of Corepack.
- **`next-env.d.ts` was committed by mistake.** Next.js regenerates it, so it kept showing up as changed. Fix: added it to `.gitignore`, removed it from git, and made the web `typecheck` script run `next typegen` first so a clean clone still typechecks.
- **A non-existent `next dev --env-file` flag.** An AI tool suggested it; Next.js has no such flag. Fix: load the root `.env` in `next.config.ts` with `loadEnvConfig(repoRoot)` from `@next/env`.
- **Lesson: verify AI tool claims against the official docs.** Flags, config keys, action versions and data paths change between versions. Check the docs or the release notes before trusting a suggestion, especially for new major versions (Next.js 16, pnpm 12, Postgres 18).

---

## 4. Interview topics

**Lockfiles.** A lockfile records the exact resolved version (and integrity hash) of every dependency, including transitive ones. Commit it so every machine and CI installs the same tree. `package.json` ranges say what's allowed; the lockfile says what was chosen. Update it on purpose, not as a side effect of installing.

**Monorepo vs polyrepo vs workspaces.** A polyrepo has one repo per project: clear ownership, but shared code needs publishing and version coordination. A monorepo puts related projects in one repo: atomic changes across packages and one CI. Workspaces are the package-manager feature (pnpm/npm/yarn) that makes a monorepo practical by linking local packages and hoisting a single lockfile.

**TypeScript strict mode, `noUncheckedIndexedAccess`, `isolatedModules`.** `strict` turns on `strictNullChecks`, `noImplicitAny` and related checks. `noUncheckedIndexedAccess` makes `arr[i]` and `record[key]` include `undefined`, which catches out-of-bounds bugs. `isolatedModules` makes sure each file can be compiled alone, which tools like esbuild, tsx and SWC need (for example, type-only re-exports must use `export type`).

**tsx doesn't type-check.** tsx (and esbuild) strip types and run the code; type errors don't stop it. That's why `tsc --noEmit` runs separately in `typecheck` and in CI. Fast dev loop, strict check in CI.

**ESLint vs Prettier.** Prettier formats code (whitespace, quotes, line breaks) and has almost no options. ESLint finds likely bugs and bad patterns (unused vars, floating promises). `eslint-config-prettier` turns off ESLint's style rules so the two never fight. Run both in CI: `lint` and `format:check`.

**Runtime validation of external data.** TypeScript types disappear at runtime, so data from outside (HTTP bodies, env vars, API responses, LLM output) is just `unknown`. Validate it at the boundary with a schema (Zod) and only then treat it as typed. Example: the web app validates the API's `/health` response with the shared schema.

**12-factor config.** Config that changes between environments (URLs, ports, secrets) lives in environment variables, not in code. The same build artifact runs in dev, CI and prod with different env. Validate it at startup and fail fast; never commit real values (`.env` is git-ignored, `.env.example` documents the keys).

**Liveness vs readiness.** Liveness: "is the process alive, or should it be restarted?" It should be cheap and not check dependencies. Readiness: "can this instance take traffic right now?" It checks the DB, Redis and so on. A failed readiness check removes the instance from the load balancer without restarting it.

**Graceful shutdown.** On SIGTERM, stop accepting new connections, let in-flight requests finish, close DB and queue connections, then exit. Fastify's `app.close()` does the first parts. Without it, deploys and restarts drop requests. Orchestrators send SIGTERM, then SIGKILL after a grace period.

**Server components vs client fetching.** Server components run on the server: they can use secrets and server-only env, fetch data close to the source, and send HTML with no client JS. Client fetching runs in the browser: needed for interactivity and live updates, but every URL and token it uses is public. Default to server components; add client components only where needed.

**`NEXT_PUBLIC_` variables.** Next.js inlines `NEXT_PUBLIC_*` values into the client JavaScript at build time. They are public to anyone who opens the site, and changing them needs a rebuild. Never put secrets in them. Variables without the prefix stay on the server.

**Containers vs VMs.** A VM virtualizes hardware and runs a full guest OS kernel: strong isolation, but heavy and slow to boot. A container shares the host kernel and isolates processes with namespaces and cgroups: light, starts in milliseconds, and its image bundles the app's dependencies. On Windows and macOS, Docker Desktop runs containers inside a small Linux VM.

**Named volumes vs bind mounts.** A named volume is storage managed by Docker (`postgres-data`). It survives `docker compose down` and is removed with `down -v`, which is good for database data. A bind mount maps a host folder into the container (`./infra/postgres/init`), which is good for config and source you edit on the host. Bind mounts on Windows can have permission and performance issues.

**What CI should run, and why `--frozen-lockfile`.** CI should run everything a reviewer would otherwise check by hand: clean install, typecheck, lint, format check, tests and a production build. It must be fast, deterministic and the same for everyone. `--frozen-lockfile` makes the install fail if `package.json` and the lockfile disagree, so CI tests exactly the dependency tree that was committed.

---

## 5. Revisit later

- **API production build (Stage 9).** The API runs TypeScript through tsx, and `packages/shared` ships raw `.ts`. For production we need a real build (for example, bundling the API with esbuild/tsup, or compiling shared to JS) and must decide how shared code gets into the API image.
- **API listen address.** `server.ts` listens on `127.0.0.1`. Inside a container or on a host it must listen on `0.0.0.0` (ideally set by a config variable), or nothing outside the process can reach it.
- **Next.js ESLint plugin.** `@next/eslint-plugin-next` isn't set up yet. Add it when we start using links and images, since its rules catch `<a>` vs `<Link>` and `<img>` vs `<Image>` mistakes.
