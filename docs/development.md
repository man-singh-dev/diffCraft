# Development

Running DiffCraft locally: setup, environment variables, Docker, the project structure, testing and contributing.

[← Back to README](../README.md)

---

## Local Development Setup

> Status: **Implemented** for Stage 0 (foundation) and Stage 1 (database and auth).

### Prerequisites

- **Node.js 24** (the version is in `.nvmrc`; `nvm use` picks it up).
- **pnpm 12**, installed with npm: `npm install -g pnpm@12`. The exact version is pinned in the `packageManager` field of `package.json`. Corepack is not used because it could not run pnpm 12.
- **Docker** with Docker Compose (Docker Desktop on Windows and macOS), for local PostgreSQL and Redis.

### Steps

```bash
# 1. Clone
git clone https://github.com/man-singh-dev/diffCraft.git
cd diffCraft

# 2. Configure environment (local-only placeholder values).
#    .env must contain DATABASE_URL (the dev database, required by the API) and
#    TEST_DATABASE_URL (the separate diffcraft_test database, used only by tests).
cp .env.example .env                 # PowerShell: Copy-Item .env.example .env

# 3. Install dependencies
pnpm install

# 4. Start PostgreSQL and Redis in the background (check health with `docker compose ps`)
pnpm infra:up

# 5. Apply database migrations to the dev database (DATABASE_URL)
pnpm db:migrate

# 6. Run the API and web dev servers together (Ctrl+C stops both)
pnpm dev                             # API http://localhost:4000 (GET /health, GET /ready)
                                     # web http://localhost:3000
```

The web home page shows whether it can reach the API's `/health` endpoint. To run one server on its own: `pnpm --filter @diffcraft/api dev` or `pnpm --filter @diffcraft/web dev`. To browse the database: `pnpm db:studio`. After changing the schema, create a migration with `pnpm db:generate --name <change>`.

### Checks (the same ones CI runs)

```bash
pnpm typecheck                       # tsc for every package (web runs `next typegen` first)
pnpm lint                            # ESLint
pnpm format:check                    # Prettier (use `pnpm format` to fix)
pnpm test                            # Vitest (migrates the test database first)
pnpm --filter @diffcraft/api build   # API production bundle (esbuild → apps/api/dist)
pnpm --filter @diffcraft/web build   # Next.js production build
```

To stop the local infrastructure: `pnpm infra:down`.

---

## Environment Variables

All variables live in one root `.env` file (copied from `.env.example`). The API loads it with `--env-file-if-exists`, the web app with `loadEnvConfig` in `next.config.ts`, and Docker Compose reads it automatically. Every variable except `DATABASE_URL` has a safe local default; without `TEST_DATABASE_URL` the database tests are skipped. **Never commit real values.** `.env` is git-ignored.

### In use now (in `.env.example`)

| Variable            | Used by                  | Description                                                                           | Example placeholder                                              |
| ------------------- | ------------------------ | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `NODE_ENV`          | api                      | Runtime environment (`development`, `test`, `production`).                            | `development`                                                    |
| `HOST`              | api                      | Interface the Fastify server listens on.                                              | `127.0.0.1`                                                      |
| `API_PORT`          | api                      | Port for the Fastify server. If unset, `PORT` (set by Render), then `4000`.           | `4000`                                                           |
| `DB_POOL_MAX`       | api                      | Maximum open Postgres connections per API instance.                                   | `10`                                                             |
| `TRUST_PROXY`       | api (production only)    | Proxy addresses (IPs, CIDRs or presets) to trust for `X-Forwarded-For`.               | `uniquelocal`                                                    |
| `LOG_LEVEL`         | api                      | Logging verbosity.                                                                    | `info`                                                           |
| `WEB_ORIGIN`        | api                      | Origin of the web app. Validated at startup; will be the CORS / Socket.IO allow-list. | `http://localhost:3000`                                          |
| `API_URL`           | web (server-only)        | Base URL the web server uses to call the API. Not exposed to the browser.             | `http://localhost:4000`                                          |
| `POSTGRES_USER`     | docker-compose           | Postgres superuser created on first start.                                            | `diffcraft`                                                      |
| `POSTGRES_PASSWORD` | docker-compose           | Password for that user (local only).                                                  | `diffcraft`                                                      |
| `POSTGRES_DB`       | docker-compose           | Default database created on first start.                                              | `diffcraft`                                                      |
| `POSTGRES_PORT`     | docker-compose           | Host port for Postgres (bound to `127.0.0.1`).                                        | `5432`                                                           |
| `REDIS_PORT`        | docker-compose           | Host port for Redis (bound to `127.0.0.1`).                                           | `6379`                                                           |
| `DATABASE_URL`      | api, drizzle-kit         | PostgreSQL connection string for the API and `pnpm db:*`. **Required.**               | `postgresql://diffcraft:diffcraft@localhost:5432/diffcraft`      |
| `TEST_DATABASE_URL` | api tests                | Separate test database; migrated before the API tests. Optional (tests skip without). | `postgresql://diffcraft:diffcraft@localhost:5432/diffcraft_test` |
| `REDIS_URL`         | _not read yet_ (Stage 7) | Redis connection string for the API and worker (Socket.IO adapter, presence, BullMQ). | `redis://localhost:6379`                                         |

The API validates its variables with a Zod schema at startup and exits with a list of invalid names (never their values). The web app validates `API_URL` the same way.

### Planned

No session secret is needed: session tokens are random values looked up by their hash, not signed cookies.

| Variable              | Used by     | Description                                    | Example placeholder  |
| --------------------- | ----------- | ---------------------------------------------- | -------------------- |
| `LLM_PROVIDER`        | worker      | Identifier of the configured provider adapter. | `<provider-name>`    |
| `LLM_API_KEY`         | worker      | Provider API key. **Server-side only.**        | `<your-llm-api-key>` |
| `LLM_MODEL`           | worker      | Model identifier.                              | `<model-id>`         |
| `LLM_TIMEOUT_MS`      | worker      | Per-request timeout.                           | `60000`              |
| `AI_JOB_MAX_ATTEMPTS` | worker      | Maximum attempts per analysis job.             | `3`                  |
| `AI_MAX_DIFF_BYTES`   | api, worker | Upper bound on diff size per analysis.         | `200000`             |
| `WORKER_CONCURRENCY`  | worker      | Concurrent jobs per worker process.            | `2`                  |

---

## Docker Setup

> Status: **Implemented** for local infrastructure only. The API uses the Postgres service; nothing uses Redis until Stage 7.

`docker-compose.yml` at the repo root runs two services for local development:

| Service    | Image                | Host port (default) | Data                                                  | Healthcheck      |
| ---------- | -------------------- | ------------------- | ----------------------------------------------------- | ---------------- |
| `postgres` | `postgres:18-alpine` | `127.0.0.1:5432`    | Named volume `postgres-data` at `/var/lib/postgresql` | `pg_isready`     |
| `redis`    | `redis:8-alpine`     | `127.0.0.1:6379`    | Named volume `redis-data` at `/data`                  | `redis-cli ping` |

- Ports are bound to `127.0.0.1` only, so other machines on your network cannot reach them.
- Credentials and ports come from `.env` (`POSTGRES_*`, `REDIS_PORT`), with local defaults in the Compose file.
- Postgres 18 images store data in `/var/lib/postgresql/18/docker`, so the volume is mounted at `/var/lib/postgresql` (not the older `/var/lib/postgresql/data`).
- `infra/postgres/init/01-create-test-db.sql` creates a second database, `diffcraft_test`, for tests. Postgres runs init scripts **only when the data volume is empty** (first start). To run them again, delete the volume with `docker compose down -v`, which **deletes all local data**.

| Script            | Runs                     | Purpose                                        |
| ----------------- | ------------------------ | ---------------------------------------------- |
| `pnpm infra:up`   | `docker compose up -d`   | Start Postgres and Redis in the background.    |
| `pnpm infra:down` | `docker compose down`    | Stop and remove the containers (volumes kept). |
| `pnpm infra:logs` | `docker compose logs -f` | Follow the logs of both services.              |

Check that both services are healthy with `docker compose ps`.

Per-app Dockerfiles for `api`, `worker` and `web` are **Planned** (Stage 9).

---

## Project Structure

The tree below is the **current** repository (excluding `node_modules` and build output). Entries marked _(planned)_ do not exist yet. Test files (`*.test.ts`) sit next to the file they test and are left out of the tree.

```text
diffCraft/
├── .github/
│   └── workflows/
│       └── ci.yml                    # CI: typecheck, lint, format check, test, API and web builds
├── apps/
│   ├── api/                          # Fastify API
│   │   ├── drizzle/                  # Generated SQL migrations (0000_init.sql) and Drizzle metadata
│   │   ├── scripts/
│   │   │   └── build.ts              # esbuild bundle of server.ts and migrate.ts into dist/
│   │   ├── src/
│   │   │   ├── app.ts                # buildApp(): registers plugins and routes (no listen)
│   │   │   ├── server.ts             # Entry point: config, listen, graceful shutdown
│   │   │   ├── migrate.ts            # Applies pending migrations (run on start in production)
│   │   │   ├── config.ts             # Zod-validated environment config
│   │   │   ├── logger.ts             # Logger options
│   │   │   ├── errors.ts             # AppError and ValidationError
│   │   │   ├── db/
│   │   │   │   ├── errors.ts         # isUniqueViolation (Postgres error helper)
│   │   │   │   └── schema/           # Drizzle schema: users.ts, sessions.ts, workspaces.ts, index.ts
│   │   │   ├── modules/
│   │   │   │   ├── auth/
│   │   │   │   │   ├── routes.ts     # POST register/login/logout, GET me under /api/v1/auth
│   │   │   │   │   ├── service.ts    # registerUser, verifyCredentials (timing-safe)
│   │   │   │   │   ├── session.ts    # Session tokens, hashing, cookie options, 7-day expiry
│   │   │   │   │   ├── password.ts   # Argon2id hash and verify
│   │   │   │   │   └── require-auth.ts # requireAuth preHandler (401 without a valid session)
│   │   │   │   └── workspaces/
│   │   │   │       ├── routes.ts     # POST/GET /, GET/PATCH/DELETE /:workspaceId under /api/v1/workspaces
│   │   │   │       ├── service.ts    # slugify, create/list/get/rename/delete, getMembership
│   │   │   │       ├── member-routes.ts  # /:workspaceId/members: list, add, change role, remove, leave
│   │   │   │       ├── member-service.ts # Member rules, last-owner check, workspace row lock
│   │   │   │       └── require-workspace-role.ts # requireWorkspaceRole(minimum) preHandler (404 / 403)
│   │   │   ├── plugins/
│   │   │   │   ├── csrf.ts           # Origin check on state-changing requests
│   │   │   │   ├── db.ts             # pg pool + Drizzle instance as app.db
│   │   │   │   └── error-handler.ts  # Consistent error responses; generic 500s
│   │   │   ├── routes/
│   │   │   │   ├── health.ts         # GET /health (liveness)
│   │   │   │   └── ready.ts          # GET /ready (readiness, checks the database)
│   │   │   └── test/
│   │   │       ├── db.ts             # Test database helpers
│   │   │       ├── fixtures.ts       # createUserWithSession, addMember
│   │   │       └── global-setup.ts   # Migrates diffcraft_test before the tests
│   │   ├── drizzle.config.ts
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── vitest.config.ts
│   ├── web/                          # Next.js frontend (App Router)
│   │   ├── src/
│   │   │   ├── app/
│   │   │   │   ├── layout.tsx
│   │   │   │   ├── page.tsx          # Home page: API health plus log in / sign up / workspaces links
│   │   │   │   ├── globals.css
│   │   │   │   ├── login/            # page.tsx, login-form.tsx
│   │   │   │   ├── register/         # page.tsx, register-form.tsx (sign-up)
│   │   │   │   └── (app)/            # Logged-in pages (route group: not part of the URL)
│   │   │   │       ├── layout.tsx    # Adds the nav bar
│   │   │   │       ├── profile/      # page.tsx
│   │   │   │       └── workspaces/   # page.tsx (list), create-workspace-form.tsx
│   │   │   │           └── [workspaceId]/ # page.tsx, not-found.tsx, member-controls.tsx, add-member-form.tsx,
│   │   │   │                              # rename-workspace-form.tsx, delete-workspace.tsx, leave-workspace.tsx
│   │   │   ├── components/           # form-field.tsx, page-card.tsx, styles.ts, nav.tsx, logout-button.tsx, role-badge.tsx
│   │   │   └── lib/
│   │   │       ├── api-client.ts     # Browser calls to the API via relative /api URLs
│   │   │       ├── api-errors.ts     # API error codes → friendly messages
│   │   │       ├── api.server.ts     # Server-side GETs with the session cookie (workspaces, members)
│   │   │       ├── api-health.ts     # Fetches and validates GET /health
│   │   │       ├── auth.server.ts    # Server-side current-user lookup
│   │   │       ├── form-errors.ts    # Client-side form validation; API errors → field messages
│   │   │       └── env.server.ts     # Server-only, Zod-validated API_URL
│   │   ├── AGENTS.md                 # Generated by Next.js for AI coding tools
│   │   ├── next.config.ts            # Loads the root .env, /api rewrite to the API, transpiles @diffcraft/shared
│   │   ├── postcss.config.mjs
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── vitest.config.ts
│   └── worker/                       # (planned) BullMQ consumer for AI analysis
├── packages/
│   └── shared/                       # Zod schemas and inferred types (raw TS, no build step)
│       ├── src/
│       │   ├── index.ts
│       │   ├── auth.ts               # Register/login requests, public user, error response
│       │   ├── diff/                 # parsePatch (unified diff → files/hunks/lines), schemas, fixtures/
│       │   ├── health.ts             # HealthResponseSchema
│       │   ├── ready.ts              # Readiness response
│       │   ├── workspaces.ts         # Workspace roles, canManageMember, workspace and member schemas
│       │   └── zod-issues.ts         # Zod error formatter
│       ├── scripts/parse-patch.ts    # Try the parser: node packages/shared/scripts/parse-patch.ts <file>
│       ├── package.json
│       ├── tsconfig.json
│       └── vitest.config.ts
├── infra/
│   └── postgres/
│       └── init/
│           └── 01-create-test-db.sql # Creates diffcraft_test on first start
├── docs/                             # Detailed documentation (index: docs/README.md)
│   ├── README.md                     # Index of the docs folder
│   ├── architecture.md               # Goals, components, data flow, lifecycle, deployment architecture
│   ├── database.md                   # Database design
│   ├── api.md                        # API design
│   ├── security.md                   # Authentication, authorization, security safeguards
│   ├── development.md                # This file
│   ├── deployment.md                 # Vercel, Render and Neon
│   ├── roadmap.md                    # Current status, roadmap, future enhancements
│   ├── design/
│   │   ├── realtime.md               # (planned feature) Real-time events
│   │   └── ai-analysis.md            # (planned feature) AI pipeline and background jobs
│   └── adr/                          # (planned) Architecture decision records
├── .env.example                      # All environment variables with local placeholder values
├── .gitattributes                    # LF line endings everywhere
├── .gitignore
├── .nvmrc                            # Node.js version
├── .prettierignore
├── .prettierrc
├── docker-compose.yml                # Local PostgreSQL and Redis
├── eslint.config.mjs
├── package.json                      # Root scripts and pinned pnpm version
├── pnpm-lock.yaml
├── pnpm-workspace.yaml
├── tsconfig.base.json                # Shared strict compiler options
├── vitest.config.mts                 # Runs each app/package as a Vitest project
└── README.md                         # Front page: overview, quick start, links to docs/
```

As the API grows, each feature gets its own `modules/<feature>/` folder, and `apps/api/src` is expected to gain a `realtime/` folder _(planned)_. The worker may first live as a second entrypoint inside `apps/api` to share the database layer, and be split out later.

---

## Testing Strategy

> Status: **Implemented** for the levels marked below; the rest are **Planned**. No coverage figures are claimed.

All tests use Vitest, sit next to the file they test (`*.test.ts`), and run with `pnpm test` from the root. The API's Vitest global setup migrates the separate `diffcraft_test` database first. Tests that need it are skipped when `TEST_DATABASE_URL` is unset.

### Exists now

| Level             | What is covered today                                                                                                                                                                                                                                                                                        |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Unit              | API config validation, logger, password hashing, error handler, CSRF Origin check.                                                                                                                                                                                                                           |
| API integration   | Auth routes, sessions and the auth service, `/health`, `/ready`, the unique email index, and the workspaces service and its constraints (slug retry, transaction atomicity, composite key, role `CHECK`, `CASCADE` / `SET NULL`), exercised with Fastify's `inject` against a real PostgreSQL test database. |
| Schema / contract | Shared Zod schemas in `packages/shared` (health, readiness, auth requests and responses, the Zod error formatter).                                                                                                                                                                                           |
| Web helpers       | `apps/web/src/lib`: the API client, API health fetch, server-side current-user lookup and form error mapping.                                                                                                                                                                                                |
| CI                | GitHub Actions runs typecheck, lint, format check, the full test suite against a PostgreSQL 18 service container, and the API and web builds on every PR and push to `main`.                                                                                                                                 |

### Planned

| Level           | Scope                                                                                                                                                           | Tooling (intended)          |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| Unit            | Status recomputation, permission rules, diff parsing and line mapping, idempotency key generation, finding-to-line mapping, redaction.                          | Vitest                      |
| API integration | Authorization (including cross-workspace access attempts) and conflict handling for workspace and review routes.                                                | Vitest, PostgreSQL          |
| Real-time       | Socket handshake auth, room authorization, emit-after-commit (no event on failed writes).                                                                       | Vitest + `socket.io-client` |
| Worker          | Retry/backoff classification, timeout handling, invalid-output handling and idempotent completion, using a **mocked LLM provider** (no network calls in tests). | Vitest                      |
| Frontend        | Component tests for diff rendering, thread interactions and reconnect re-fetch behaviour.                                                                       | Vitest + Testing Library    |
| End-to-end      | Full browser flows against a running web app and API.                                                                                                           | To be chosen                |

---

## Contributing

DiffCraft is at an early stage, and the architecture is still being established. Contributions and design feedback are welcome.

1. **Open an issue first** for anything non-trivial, so the approach can be discussed against the planned architecture.
2. **Fork and branch** from `main` using a descriptive branch name (e.g. `feat/review-approvals`, `fix/comment-pagination`).
3. **Keep changes focused.** One concern per pull request.
4. **Validate at boundaries.** New endpoints and events should come with Zod schemas in `packages/shared`.
5. **Include tests** for new behaviour, including authorization failure cases.
6. **Never commit secrets** or real `.env` files.
7. **Update documentation** — including the [Current Status](roadmap.md#current-status) table — when a feature moves from Planned to In progress or Implemented.
8. Use clear commit messages (Conventional Commits are encouraged).

A `CONTRIBUTING.md` and code of conduct will be added as the project matures.
