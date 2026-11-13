# Development

Running DiffCraft locally: setup, environment variables, Docker, the project structure, testing and contributing.

[← Back to README](../README.md)

---

## Local Development Setup

> Status: **Implemented.** The README has a short version of this guide: [Getting started from scratch](../README.md#getting-started-from-scratch).

### Prerequisites

| Tool           | Version                                                | Check            |
| -------------- | ------------------------------------------------------ | ---------------- |
| Node.js        | 24 (in `.nvmrc`; `engines` in package.json says >= 24) | `node --version` |
| pnpm           | 12.15.0 (pinned in `packageManager` in package.json)   | `pnpm --version` |
| Docker Desktop | Any recent version with Docker Compose v2              | `docker info`    |
| Git            | Any recent version                                     | `git --version`  |

- **Node.js 24.** With nvm (macOS / Linux) or nvm-windows: `nvm install 24` then `nvm use 24`. The installer from nodejs.org works too.
- **pnpm 12.15.0.** Either install it globally with npm, `npm install -g pnpm@12.15.0`, or skip the global install and write `npx -y pnpm@12.15.0` wherever this guide says `pnpm` (for example `npx -y pnpm@12.15.0 install`). The root scripts call `pnpm` again internally, and that works in both cases. **Corepack is not used:** it could not run pnpm 12. If Corepack was enabled before, run `corepack disable`.
- **Docker Desktop** (Windows, macOS) or Docker Engine with the Compose plugin (Linux), for local PostgreSQL, Redis and Mailpit. It must be running whenever you run the app or the tests.

### Steps

```bash
# 1. Clone
git clone https://github.com/man-singh-dev/diffCraft.git
cd diffCraft
```

```bash
# 2. Create .env from the example (local-only placeholder values).
#    Skip this if you already have a .env: copying would overwrite it.
cp -n .env.example .env                                         # macOS / Linux (-n never overwrites)
```

```powershell
if (-not (Test-Path .env)) { Copy-Item .env.example .env }      # Windows PowerShell
```

```bash
# 3. Install dependencies
pnpm install

# 4. Start PostgreSQL, Redis and Mailpit in the background (check health with `docker compose ps`)
pnpm infra:up

# 5. Apply database migrations to the dev database (DATABASE_URL)
pnpm db:migrate

# 6. Run the API and web dev servers together (Ctrl+C stops both)
pnpm dev                             # API http://localhost:4000, web http://localhost:3000
```

To run one server on its own: `pnpm --filter @diffcraft/api dev` or `pnpm --filter @diffcraft/web dev`. To browse the database: `pnpm db:studio`. After changing the schema, create a migration with `pnpm db:generate --name <change>`.

### Check it works

| Open                         | Expect                                                                                   |
| ---------------------------- | ---------------------------------------------------------------------------------------- |
| http://localhost:3000        | The home page, showing that the web server can reach the API's `/health`.                |
| http://localhost:4000/health | `{"status":"ok","uptimeSeconds":…,"timestamp":…}`: the API process is up (liveness).     |
| http://localhost:4000/ready  | `{"status":"ready"}`: the API can reach Postgres and Redis. `503 not_ready` if not.      |
| http://localhost:8025        | The Mailpit inbox, which catches every email the API sends. Nothing leaves your machine. |

**Sign up and verify your email:** create an account at http://localhost:3000/register. A banner on every logged-in page asks you to verify your email. Open Mailpit, open the "Verify your DiffCraft email address" message, follow the link and press **Confirm** on the `/verify-email` page (the page never verifies on load, because email scanners open links automatically). "Resend email" in the banner sends a new link, at most once a minute. Until you verify, admins can't add you to their workspaces.

**Try the rest:** create a workspace, paste a unified diff into a new review (for example the output of `git diff`), open "Files changed", comment on a line, and press "Run AI review" on the review page. With the default `AI_PROVIDER=fake` the findings are examples, produced without any network call.

### Checks (the same ones CI runs)

```bash
pnpm test                            # Vitest; needs Docker running (migrates the test database first)
pnpm typecheck                       # tsc for every package (web runs `next typegen` first)
pnpm lint                            # ESLint
pnpm format:check                    # Prettier (use `pnpm format` to fix)
pnpm --filter @diffcraft/api build   # API production bundle (esbuild → apps/api/dist)
pnpm --filter @diffcraft/web build   # Next.js production build
```

`pnpm test` reads `TEST_DATABASE_URL` and `TEST_REDIS_URL` from `.env`. With `TEST_DATABASE_URL` set but Postgres down, the run fails while migrating the test database. Without `TEST_DATABASE_URL` the database tests are skipped, and with Redis unreachable the Redis tests (realtime, `/ready`, rate limits) are skipped with a warning.

To stop the local infrastructure: `pnpm infra:down` (your data stays in Docker volumes).

### Troubleshooting

| Symptom                                                                                 | Cause and fix                                                                                                                                                                                                                                                                                                           |
| --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sign-up or login fails with a generic error; `/ready` returns `503 not_ready`           | Docker isn't running, so Postgres and Redis are down. Start Docker Desktop, run `pnpm infra:up`, and wait until `docker compose ps` shows the services as healthy.                                                                                                                                                      |
| `docker compose` errors such as "Cannot connect to the Docker daemon"                   | Same cause: start Docker Desktop and try again.                                                                                                                                                                                                                                                                         |
| Every page that loads data fails with a 500; the API log says a relation does not exist | The migrations haven't run on the dev database. Run `pnpm db:migrate`.                                                                                                                                                                                                                                                  |
| `pnpm test` fails before any test runs, while migrating                                 | Postgres isn't running, or the `diffcraft_test` database is missing. Start Docker. The database is created only when the Postgres volume is first created; to recreate it, `docker compose down -v` (**deletes all local data**) then `pnpm infra:up`.                                                                  |
| `EADDRINUSE` / port 3000 or 4000 already in use                                         | An old dev server is still running. PowerShell: `Get-NetTCPConnection -LocalPort 3000,4000 -State Listen -ErrorAction SilentlyContinue \| Select-Object -ExpandProperty OwningProcess -Unique \| ForEach-Object { Stop-Process -Id $_ -Force }`. macOS / Linux: `kill $(lsof -t -i tcp:3000 -i tcp:4000 -sTCP:LISTEN)`. |
| Port 5432, 6379, 1025 or 8025 already in use when running `pnpm infra:up`               | Another Postgres, Redis or mail catcher is running on your machine. Stop it, or change `POSTGRES_PORT`, `REDIS_PORT` or `MAILPIT_*_PORT` in `.env` (and the matching URLs, such as `DATABASE_URL`).                                                                                                                     |
| Live updates don't arrive; the review header doesn't show "Live"                        | `NEXT_PUBLIC_REALTIME_URL` is missing or wrong. Set it to `http://localhost:4000` in `.env` and restart `pnpm dev` (the value is inlined when the web app starts). The browser console shows a warning when it is unset.                                                                                                |
| Sign-up, login and other forms fail with a `403 forbidden_origin` error                 | `WEB_ORIGIN` doesn't match the address in the browser. Use http://localhost:3000 (not `127.0.0.1:3000`), or set `WEB_ORIGIN` to the address you use and restart.                                                                                                                                                        |
| "Run AI review" fails with an authentication or rate-limit error                        | With `AI_PROVIDER=openai_compatible`, check `AI_API_KEY`, `AI_BASE_URL` and `AI_MODEL`. Free tiers allow only a few requests per minute: wait and press "Try again", or go back to `AI_PROVIDER=fake`.                                                                                                                  |
| Corepack errors (signature, key or wrong pnpm version)                                  | Don't use Corepack. Run `corepack disable`, then install pnpm with `npm install -g pnpm@12.15.0`, or use `npx -y pnpm@12.15.0 <command>`.                                                                                                                                                                               |

---

## Environment Variables

All variables live in one root `.env` file (copied from `.env.example`). The API loads it with `--env-file-if-exists`, the web app with `loadEnvConfig` in `next.config.ts`, Docker Compose reads it automatically, and the API's Vitest config reads the test URLs from it. Every variable except `DATABASE_URL` has a safe local default. **Never commit real values.** `.env` is git-ignored. Docs and examples use placeholders such as `<your-key>`.

### The important ones

| Variable                   | What it is for                                                                                                                                                                                              |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`             | The development database (the Docker Postgres). Used by the API and `pnpm db:*`. **Required.**                                                                                                              |
| `TEST_DATABASE_URL`        | A separate `diffcraft_test` database, created on Postgres's first start by `infra/postgres/init/01-create-test-db.sql` and migrated automatically before the API tests. Never point it at a real database.  |
| `REDIS_URL`                | Redis for realtime tickets, the Socket.IO adapter, the BullMQ AI queue, rate-limit counters and `/ready`.                                                                                                   |
| `WEB_ORIGIN`               | The web app's origin. The API's CSRF check rejects state-changing requests from any other `Origin`, and the Socket.IO server accepts only this origin.                                                      |
| `NEXT_PUBLIC_REALTIME_URL` | The API origin the browser's Socket.IO client connects to. Public: inlined into the browser bundle when the web app builds or starts, so restart `pnpm dev` after changing it. Unset: live updates are off. |
| `MAIL_TRANSPORT`           | `smtp` (default) sends every email to Mailpit (`MAIL_SMTP_URL=smtp://localhost:1025`, inbox at http://localhost:8025). `log` writes each email, link included, to the API log instead.                      |
| `AI_PROVIDER`              | `fake` (default outside production) returns example findings with no network call. `openai_compatible` calls a real model (see below). `disabled` turns AI review off (`POST …/analyses` answers `503`).    |

**Using a real model with a free Groq key.** Create a key at [console.groq.com](https://console.groq.com), set these in `.env` and restart `pnpm dev`:

```dotenv
AI_PROVIDER=openai_compatible
AI_BASE_URL=https://api.groq.com/openai/v1
AI_API_KEY=<your-groq-key>
AI_MODEL=openai/gpt-oss-120b
```

Other OpenAI-compatible providers (Cerebras, OpenRouter, Gemini) are listed in `.env.example` and [design/ai-analysis.md](design/ai-analysis.md#configuration). Free tiers have low rate limits and **may use prompts for training: don't send private code to them.** Likely secrets are masked before sending, but the code itself is sent as-is.

### All variables (in `.env.example`)

| Variable                                | Used by               | Description                                                                                                                                                                                     | Example placeholder                                              |
| --------------------------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `NODE_ENV`                              | api                   | Runtime environment (`development`, `test`, `production`).                                                                                                                                      | `development`                                                    |
| `HOST`                                  | api                   | Interface the Fastify server listens on.                                                                                                                                                        | `127.0.0.1`                                                      |
| `API_PORT`                              | api                   | Port for the Fastify server. If unset, `PORT` (set by Render), then `4000`.                                                                                                                     | `4000`                                                           |
| `LOG_LEVEL`                             | api                   | Logging verbosity.                                                                                                                                                                              | `info`                                                           |
| `WEB_ORIGIN`                            | api                   | Origin of the web app: the CSRF Origin check and the Socket.IO origin allow-list.                                                                                                               | `http://localhost:3000`                                          |
| `API_URL`                               | web (server-only)     | Base URL the web server uses to call the API, and the target of the `/api` rewrite. Not exposed to the browser.                                                                                 | `http://localhost:4000`                                          |
| `NEXT_PUBLIC_REALTIME_URL`              | web (browser)         | The API's origin (no path) for the Socket.IO client. Inlined at build time. Unset: live updates are off (a console warning in development); not an `http(s)` origin: off, with a console error. | `http://localhost:4000`                                          |
| `POSTGRES_USER`                         | docker-compose        | Postgres superuser created on first start.                                                                                                                                                      | `diffcraft`                                                      |
| `POSTGRES_PASSWORD`                     | docker-compose        | Password for that user (local only).                                                                                                                                                            | `diffcraft`                                                      |
| `POSTGRES_DB`                           | docker-compose        | Default database created on first start.                                                                                                                                                        | `diffcraft`                                                      |
| `POSTGRES_PORT`                         | docker-compose        | Host port for Postgres (bound to `127.0.0.1`).                                                                                                                                                  | `5432`                                                           |
| `REDIS_PORT`                            | docker-compose        | Host port for Redis (bound to `127.0.0.1`).                                                                                                                                                     | `6379`                                                           |
| `DATABASE_URL`                          | api, drizzle-kit      | PostgreSQL connection string for the API and `pnpm db:*`. **Required.**                                                                                                                         | `postgresql://diffcraft:diffcraft@localhost:5432/diffcraft`      |
| `DB_POOL_MAX`                           | api                   | Maximum open Postgres connections per API instance.                                                                                                                                             | `10`                                                             |
| `TRUST_PROXY`                           | api (production only) | Proxy addresses (IPs, CIDRs or presets) to trust for `X-Forwarded-For`.                                                                                                                         | `uniquelocal`                                                    |
| `WEB_PROXY_SECRET`                      | api, web              | Shared secret with which the web server forwards the real client IP for rate limits. At least 32 characters. Required in production while rate limiting is on; optional locally.                | `<random-32-plus-characters>`                                    |
| `RATE_LIMIT_ENABLED`                    | api                   | `false` turns every rate limit off.                                                                                                                                                             | `true`                                                           |
| `RATE_LIMIT_PREFIX`                     | api                   | Redis key prefix for the counters; give each environment sharing one Redis its own.                                                                                                             | `diffcraft:rl:`                                                  |
| `RATE_LIMIT_*` (8 limits)               | api                   | Global per IP per minute; login per IP and per email; registration per IP; verification resends, tickets, analyses and comments per user. Defaults in `.env.example`.                           | `300`, `10`, `5`, …                                              |
| `TEST_DATABASE_URL`                     | api tests             | Separate test database; migrated before the API tests. Optional (database tests skip without it).                                                                                               | `postgresql://diffcraft:diffcraft@localhost:5432/diffcraft_test` |
| `REDIS_URL`                             | api                   | Redis (`redis://` or `rediss://`; may hold a password). Defaults to the local Redis; **required** in production.                                                                                | `redis://localhost:6379`                                         |
| `TEST_REDIS_URL`                        | api tests             | Redis for the tests (else `REDIS_URL`, else the local default). Database 1 keeps test keys apart. Tests that need Redis skip if it's unreachable.                                               | `redis://localhost:6379/1`                                       |
| `MAIL_TRANSPORT`                        | api                   | `smtp` (default) or `log`.                                                                                                                                                                      | `smtp`                                                           |
| `MAIL_SMTP_URL`                         | api                   | SMTP server, `smtp://` or `smtps://` (may hold credentials: never commit a real one). Defaults to Mailpit outside production; **required** in production with `smtp`.                           | `smtp://localhost:1025`                                          |
| `MAIL_FROM`                             | api                   | Sender address. Same default and requirement as `MAIL_SMTP_URL`.                                                                                                                                | `DiffCraft <noreply@localhost>`                                  |
| `MAILPIT_SMTP_PORT`                     | docker-compose        | Host port for Mailpit's SMTP server (bound to `127.0.0.1`).                                                                                                                                     | `1025`                                                           |
| `MAILPIT_UI_PORT`                       | docker-compose        | Host port for Mailpit's web inbox (bound to `127.0.0.1`).                                                                                                                                       | `8025`                                                           |
| `AI_PROVIDER`                           | api                   | `fake` (default outside production), `openai_compatible` or `disabled`. **Required** in production.                                                                                             | `fake`                                                           |
| `AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL` | api                   | The OpenAI-compatible endpoint, key and model. Required for `openai_compatible`. The key is a secret: never commit it; the API never logs it.                                                   | `<your-key>`                                                     |
| `AI_MAX_OUTPUT_TOKENS`                  | api                   | Output token budget per call; keep it generous for reasoning models.                                                                                                                            | `8000`                                                           |
| `AI_MAX_JOBS_PER_WORKSPACE_PER_DAY`     | api                   | Analyses a workspace may start per rolling 24 hours (`429` with `Retry-After` beyond that).                                                                                                     | `20`                                                             |
| `AI_WORKER_CONCURRENCY`                 | api                   | Jobs one API instance works on at once. Keep it at 1 on free tiers.                                                                                                                             | `1`                                                              |
| `AI_TIMEOUT_MS`                         | api                   | Timeout for one model call, in milliseconds.                                                                                                                                                    | `60000`                                                          |

The API validates its variables with a Zod schema at startup and exits with a list of invalid names (never their values). The web app validates `API_URL` the same way. No session secret is needed: session tokens are random values looked up by their hash, not signed cookies.

### Trying live updates

With `NEXT_PUBLIC_REALTIME_URL=http://localhost:4000` in `.env` (restart `pnpm dev` after adding it), open the same review in two browsers, or a normal and a private window, logged in as two members of the workspace. A comment, reply, edit, delete or resolve in one appears in the other without a reload. Assigning reviewers, approving, merging, editing or closing refreshes the other's review page, and deleting shows "This review was deleted". The header shows **Live** and who is viewing, and the notification bell of the other user updates. Stop the API to see **Reconnecting…**; start it again and the page re-joins and refetches what it missed. Logging out in the other window makes the next reconnect get a 401 for its ticket, and the indicator stays **Offline**.

---

## Docker Setup

> Status: **Implemented** for local infrastructure only. The API uses Postgres, Redis (realtime tickets, the Socket.IO adapter, the AI job queue, rate limits, `/ready`) and Mailpit. **The API needs Redis running**: `/ready` reports `not_ready` without it, and realtime and AI jobs fail (rate limits fail open, or fall back to memory counters for login and registration).

`docker-compose.yml` at the repo root runs three services for local development:

| Service    | Image                     | Host port (default)                                   | Data                                                  | Healthcheck          |
| ---------- | ------------------------- | ----------------------------------------------------- | ----------------------------------------------------- | -------------------- |
| `postgres` | `postgres:18-alpine`      | `127.0.0.1:5432`                                      | Named volume `postgres-data` at `/var/lib/postgresql` | `pg_isready`         |
| `redis`    | `redis:8-alpine`          | `127.0.0.1:6379`                                      | Named volume `redis-data` at `/data`                  | `redis-cli ping`     |
| `mailpit`  | `axllent/mailpit:v1.27.0` | `127.0.0.1:1025` (SMTP), `127.0.0.1:8025` (web inbox) | None (emails are lost on restart)                     | Built into the image |

**Emails in development:** the API sends every email to Mailpit by default (`MAIL_TRANSPORT=smtp`, `MAIL_SMTP_URL=smtp://localhost:1025`). Open **http://localhost:8025** to read them, e.g. the verification link after signing up. Nothing leaves your machine. Tests never send email: they pass an in-memory fake mailer to `buildApp` (`apps/api/src/test/fake-mailer.ts`).

- Ports are bound to `127.0.0.1` only, so other machines on your network cannot reach them.
- Credentials and ports come from `.env` (`POSTGRES_*`, `REDIS_PORT`, `MAILPIT_*_PORT`), with local defaults in the Compose file.
- Postgres 18 images store data in `/var/lib/postgresql/18/docker`, so the volume is mounted at `/var/lib/postgresql` (not the older `/var/lib/postgresql/data`).
- `infra/postgres/init/01-create-test-db.sql` creates a second database, `diffcraft_test`, for tests. Postgres runs init scripts **only when the data volume is empty** (first start). To run them again, delete the volume with `docker compose down -v`, which **deletes all local data**.

| Script            | Runs                     | Purpose                                              |
| ----------------- | ------------------------ | ---------------------------------------------------- |
| `pnpm infra:up`   | `docker compose up -d`   | Start Postgres, Redis and Mailpit in the background. |
| `pnpm infra:down` | `docker compose down`    | Stop and remove the containers (volumes kept).       |
| `pnpm infra:logs` | `docker compose logs -f` | Follow the logs of all services.                     |

Check that the services are healthy with `docker compose ps`.

Per-app Dockerfiles for `api` and `web` are **Planned** (Stage 9).

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
│   │   ├── drizzle/                  # Generated SQL migrations (0000_init … 0008_finding_feedback) and Drizzle metadata
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
│   │   │   │   └── schema/           # Drizzle schema: users, sessions, email verification, workspaces, reviews,
│   │   │   │                         # comments, approvals, notifications (+ outbox), ai, sql-list.ts
│   │   │   ├── mail/
│   │   │   │   ├── mailer.ts         # Mailer interface; SMTP (nodemailer) and log transports, chosen by MAIL_TRANSPORT
│   │   │   │   └── plugin.ts         # app.mailer (tests pass a fake to buildApp)
│   │   │   ├── modules/
│   │   │   │   ├── ai/
│   │   │   │   │   ├── routes.ts     # Start an analysis, latest job + findings, dismiss, feedback
│   │   │   │   │   ├── service.ts    # Jobs (idempotency key, daily limit), findings, feedback
│   │   │   │   │   ├── queue.ts      # BullMQ queue; job ID = database job ID
│   │   │   │   │   ├── worker.ts     # In-process BullMQ worker, retries, sweeper for lost jobs
│   │   │   │   │   ├── context.ts    # Bounded context from the diff hunks (skips lockfiles, minified, binary)
│   │   │   │   │   ├── redact.ts     # Masks likely secrets before the model call
│   │   │   │   │   ├── prompt.ts     # System prompt with random delimiters around the untrusted diff
│   │   │   │   │   ├── mapping.ts    # Validated findings → real diff lines (others dropped)
│   │   │   │   │   ├── events.ts     # analysis:status / analysis:completed
│   │   │   │   │   └── providers/    # openai-compatible.ts (official openai SDK), fake.ts, types.ts
│   │   │   │   ├── auth/
│   │   │   │   │   ├── routes.ts     # POST register/login/logout/verify-email/resend-verification, GET me
│   │   │   │   │   ├── service.ts    # registerUser (user + verification token in one transaction), verifyCredentials
│   │   │   │   │   ├── verification.ts # Verification tokens (hashed, 24 h, single use), resend throttle, email
│   │   │   │   │   ├── session.ts    # Session tokens, hashing, cookie options, 7-day expiry
│   │   │   │   │   ├── password.ts   # Argon2id hash and verify
│   │   │   │   │   └── require-auth.ts # requireAuth preHandler (401 without a valid session)
│   │   │   │   ├── approvals/
│   │   │   │   │   ├── routes.ts     # Under a review: state, reviewers, decisions, merge, events; /:workspaceId/rules
│   │   │   │   │   ├── service.ts    # Rules, reviewers, decisions (only since the current assignment), merge under
│   │   │   │   │   │                 # the review lock, events
│   │   │   │   │   └── errors.ts     # invalid_reviewers, not_a_reviewer, review_not_open, merge_blocked, …
│   │   │   │   ├── comments/
│   │   │   │   │   ├── service.ts    # Threads and comments: create (anchor checked), list (2 queries), reply,
│   │   │   │   │   │                 # edit, soft delete, resolve / reopen; all scoped by workspace
│   │   │   │   │   └── errors.ts     # invalid_anchor
│   │   │   │   ├── notifications/
│   │   │   │   │   ├── routes.ts     # List, unread count, read, read-all
│   │   │   │   │   ├── service.ts    # notify(): notification + outbox rows in the caller's transaction
│   │   │   │   │   ├── relay.ts      # Outbox relay: FOR UPDATE SKIP LOCKED, emit, mark published, retries, cleanup
│   │   │   │   │   └── plugin.ts     # Starts and stops the relay with the server
│   │   │   │   ├── realtime/
│   │   │   │   │   ├── routes.ts     # POST /api/v1/realtime/ticket
│   │   │   │   │   ├── ticket.ts     # Tickets: 32 random bytes, SHA-256 in Redis for 30 s, taken with GETDEL
│   │   │   │   │   ├── socket-server.ts # Socket.IO (ticket handshake, review:join/leave, limits, Redis adapter,
│   │   │   │   │   │                 # user rooms, app.realtime.emitToReview)
│   │   │   │   │   ├── publish.ts    # Emit-after-commit publishers for threads and review changes
│   │   │   │   │   ├── presence.ts   # "Who's viewing" from the room's sockets, coalesced
│   │   │   │   │   └── access.ts     # Revoking access across instances; 5-minute safety net
│   │   │   │   ├── reviews/
│   │   │   │   │   ├── routes.ts     # /:workspaceId/reviews: create, list, get, edit, delete, files, diff
│   │   │   │   │   ├── service.ts    # createReview (parse, number, store files), list (keyset), update, delete
│   │   │   │   │   ├── cursor.ts     # Opaque list cursor (created_at with microseconds, id)
│   │   │   │   │   └── errors.ts     # review_not_found, invalid_patch, invalid_cursor, …
│   │   │   │   └── workspaces/
│   │   │   │       ├── routes.ts     # POST/GET /, GET/PATCH/DELETE /:workspaceId under /api/v1/workspaces
│   │   │   │       ├── service.ts    # slugify, create/list/get/rename/delete, getMembership
│   │   │   │       ├── member-routes.ts  # /:workspaceId/members: list, add, change role, remove, leave
│   │   │   │       ├── member-service.ts # Member rules, last-owner check, workspace row lock
│   │   │   │       └── require-workspace-role.ts # requireWorkspaceRole(minimum) preHandler (404 / 403)
│   │   │   ├── plugins/
│   │   │   │   ├── csrf.ts           # Origin check on state-changing requests
│   │   │   │   ├── db.ts             # pg pool + Drizzle instance as app.db
│   │   │   │   ├── redis.ts          # ioredis client as app.redis (lazy connect), closed on shutdown
│   │   │   │   ├── client-ip.ts      # Real client IP from the web server (WEB_PROXY_SECRET) or the proxy
│   │   │   │   ├── rate-limit.ts     # @fastify/rate-limit on Redis; named limits (app.limit), fallbacks
│   │   │   │   ├── security-headers.ts # @fastify/helmet for the API's responses
│   │   │   │   └── error-handler.ts  # Consistent error responses; generic 500s
│   │   │   ├── routes/
│   │   │   │   ├── health.ts         # GET /health (liveness)
│   │   │   │   └── ready.ts          # GET /ready (readiness, checks the database and Redis)
│   │   │   └── test/
│   │   │       ├── db.ts             # Test database helpers
│   │   │       ├── fixtures.ts       # createUserWithSession, addMember, failInsertInTransaction
│   │   │       ├── fake-mailer.ts    # In-memory mailer for tests
│   │   │       ├── redis.ts, realtime.ts # Test Redis and Socket.IO client helpers
│   │   │       └── global-setup.ts   # Migrates diffcraft_test and checks Redis before the tests
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
│   │   │   │   ├── verify-email/     # page.tsx, verify-email-form.tsx (Confirm button; works logged in or out)
│   │   │   │   └── (app)/            # Logged-in pages (route group: not part of the URL)
│   │   │   │       ├── layout.tsx    # Adds the nav bar and the verify-email banner
│   │   │   │       ├── profile/      # page.tsx
│   │   │   │       └── workspaces/   # page.tsx (list), create-workspace-form.tsx
│   │   │   │           └── [workspaceId]/ # page.tsx, not-found.tsx, member-controls.tsx, add-member-form.tsx,
│   │   │   │               │              # rename-workspace-form.tsx, delete-workspace.tsx, leave-workspace.tsx,
│   │   │   │               │              # approval-rules-card.tsx
│   │   │   │               └── reviews/  # page.tsx (list, filters), load-more-reviews.tsx
│   │   │   │                   ├── new/  # page.tsx, new-review-form.tsx, patch-preview.tsx
│   │   │   │                   └── [reviewNumber]/ # page.tsx, not-found.tsx, review-controls.tsx, merge-box.tsx,
│   │   │   │                       │                   # reviewers-panel.tsx, decision-box.tsx, review-history.tsx
│   │   │   │                       └── files/ # "Files changed": page.tsx, file-section.tsx, eager-file-diff.tsx,
│   │   │   │                                  # lazy-file-diff.tsx, hash-target.tsx
│   │   │   ├── components/           # form-field.tsx, page-card.tsx, styles.ts, nav.tsx, logout-button.tsx,
│   │   │   │                         # role-badge.tsx, review-ui.tsx (status/change badges, review row),
│   │   │   │                         # diff-table.tsx (unified / split diff table), comments-provider.tsx
│   │   │   │                         # (threads state + actions), comment-thread.tsx, comment-item.tsx,
│   │   │   │                         # comment-composer.tsx, line-comments.tsx (islands in the diff),
│   │   │   │                         # review-conversation.tsx (review page), approval-ui.tsx (decision
│   │   │   │                         # state badge, decision marks, UTC date-time),
│   │   │   │                         # verify-email-banner.tsx, resend-verification.tsx (Retry-After countdown),
│   │   │   │                         # review-live.tsx (Live indicator, presence), notification-bell.tsx,
│   │   │   │                         # ai-analysis-provider.tsx, ai-review-card.tsx, ai-finding.tsx
│   │   │   ├── proxy.ts              # Per-request CSP nonce and header, client IP forwarding
│   │   │   └── lib/
│   │   │       ├── api-client.ts     # Browser calls to the API via relative /api URLs
│   │   │       ├── api-errors.ts     # API error codes → friendly messages
│   │   │       ├── review-errors.ts  # Review and patch-parse errors → friendly messages
│   │   │       ├── review-params.ts  # UUID and review number guards, list filters from the URL
│   │   │       ├── diff-params.ts    # Diff view param, eager files, hash → target file
│   │   │       ├── diff-actions.ts   # loadFileDiff Server Action ("Load diff")
│   │   │       ├── comment-actions.ts # Comment Server Actions (create, reply, edit, delete, resolve, reload threads)
│   │   │       ├── realtime/         # Socket.IO client: URL config, tickets, one connection per tab, review rooms, useReviewRoom
│   │   │       ├── comment-errors.ts # API failures → typed comment errors with messages
│   │   │       ├── approval-actions.ts # Approval Server Actions (assign, remove, decide, merge, update rules)
│   │   │       ├── approval-errors.ts # API failures → typed approval errors (merge reasons, per-reviewer)
│   │   │       ├── approval-timeline.ts # Events + decisions → one chronological history (two pointers)
│   │   │       ├── eligible-reviewers.ts # Members who can still be assigned to a review
│   │   │       ├── thread-anchors.ts # Thread keys; which threads a unified row or split cell shows
│   │   │       ├── diff-view.server.ts # Highlighted unified / split rows
│   │   │       ├── highlight.server.ts # Shiki highlighter (JS regex engine, language allow-list)
│   │   │       ├── reveal-file.ts    # Window event that expands and loads a file (deep links)
│   │   │       ├── decode-patch-file.ts # Patch file bytes → text (UTF-8 / UTF-16 by BOM, 1 MiB limit)
│   │   │       ├── api.server.ts     # Server-side GETs with the session cookie (workspaces, members, reviews, file diffs, threads,
│   │   │       │                     # approval state, reviewers, decisions, events, rules) and apiSend for the mutations
│   │   │       ├── api-health.ts     # Fetches and validates GET /health
│   │   │       ├── auth.server.ts    # Server-side current-user lookup (cached per request)
│   │   │       ├── email-verification.ts # Verification token format, Retry-After parsing
│   │   │       ├── form-errors.ts    # Client-side form validation; API errors → field messages
│   │   │       ├── ai-actions.ts, ai-analysis.ts, ai-errors.ts # AI Server Actions, state and error messages
│   │   │       ├── notifications.ts, notifications-store.ts # Notification text and links; bell state (dedupe by id)
│   │   │       ├── csp.ts            # Content-Security-Policy builder (nonce, realtime origin)
│   │   │       ├── client-ip.ts, forwarding.server.ts # Forwarding the client IP to the API with WEB_PROXY_SECRET
│   │   │       └── env.server.ts     # Server-only, Zod-validated API_URL
│   │   ├── AGENTS.md                 # Generated by Next.js for AI coding tools
│   │   ├── next.config.ts            # Loads the root .env, /api rewrite to the API, Referrer-Policy for /verify-email, transpiles @diffcraft/shared
│   │   ├── postcss.config.mjs
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── vitest.config.ts
├── packages/
│   └── shared/                       # Zod schemas and inferred types (raw TS, no build step)
│       ├── src/
│       │   ├── index.ts
│       │   ├── ai.ts                 # AI job and finding schemas, categories, severities
│       │   ├── approvals.ts          # Approval rules, decisions, reviewers, events, evaluateReview,
│       │   │                         # canAssignReviewers / canDecide / canMerge / canTransition
│       │   ├── auth.ts               # Register/login requests, public user, error response
│       │   ├── comments.ts           # Thread and comment schemas, canComment / canEditComment / canDeleteComment /
│       │   │                         # canResolveThread
│       │   ├── diff/                 # parsePatch (unified diff → files/hunks/lines), schemas, fixtures/,
│       │   │                         # view/ (unified/split rows, word diff, line anchors, mergePieces)
│       │   ├── health.ts             # HealthResponseSchema
│       │   ├── notifications.ts      # Notification types and schemas
│       │   ├── ready.ts              # Readiness response
│       │   ├── realtime.ts           # Socket events, rooms and their Zod schemas
│       │   ├── reviews.ts            # Review schemas (create, update, list query/response), canEditReview
│       │   ├── suggestions.ts        # Suggested-change blocks → diff and patch
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
│   │   ├── realtime.md               # Real-time rooms, events and delivery
│   │   └── ai-analysis.md            # AI pipeline and background jobs
│   └── adr/                          # (planned) Architecture decision records
├── .env.example                      # All environment variables with local placeholder values
├── .gitattributes                    # LF line endings everywhere
├── .gitignore
├── .nvmrc                            # Node.js version
├── .prettierignore
├── .prettierrc
├── docker-compose.yml                # Local PostgreSQL, Redis and Mailpit
├── eslint.config.mjs
├── package.json                      # Root scripts and pinned pnpm version
├── pnpm-lock.yaml
├── pnpm-workspace.yaml
├── tsconfig.base.json                # Shared strict compiler options
├── vitest.config.mts                 # Runs each app/package as a Vitest project
└── README.md                         # Front page: overview, getting started, links to docs/
```

Each API feature has its own `modules/<feature>/` folder. The AI worker and the outbox relay run inside the API process (started once the server listens), so they share its database layer and Redis connections; either can move to its own entrypoint later.

---

## Testing Strategy

> Status: **Implemented** for the levels below, except end-to-end tests (**Planned**). No coverage figures are claimed.

All tests use Vitest, sit next to the file they test (`*.test.ts` / `*.test.tsx`), and run with `pnpm test` from the root (each app and package is a Vitest project). The API's Vitest global setup migrates the separate `diffcraft_test` database and checks Redis first. Database tests are skipped when `TEST_DATABASE_URL` is unset, and Redis tests when Redis is unreachable. No test calls a real LLM: AI tests use the fake provider or a stubbed client.

### Exists now

| Level             | What is covered                                                                                                                                                                                                                                                                                                                                               |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit              | API config validation, logger, password hashing, error handler, CSRF Origin check, security headers; AI context building, redaction, prompt building and finding-to-line mapping.                                                                                                                                                                             |
| API integration   | Every route group (auth, workspaces and members, reviews, comments, approvals, notifications, AI, `/health`, `/ready`) through Fastify's `inject` against a real PostgreSQL test database: authorization and cross-workspace `404`s, constraints, transaction atomicity (a failing insert writes nothing), and a merge vs. request-changes race run 25 times. |
| Real-time         | Ticket handshake, room authorization and limits, emit-after-commit (no event on failed writes), presence, and delivery across two app instances through the Redis adapter, with real `socket.io-client` connections.                                                                                                                                          |
| Jobs and outbox   | The AI queue and worker (claiming, retries and backoff, timeouts, invalid output and repair, idempotent completion, the sweeper) and the outbox relay (`SKIP LOCKED`, retries, give-up, cleanup).                                                                                                                                                             |
| Rate limiting     | Limits per IP, email and user against Redis, the real client IP through `WEB_PROXY_SECRET`, and behaviour with Redis unreachable (general limits fail open, login limits still answer `429`).                                                                                                                                                                 |
| Schema / contract | Shared Zod schemas and pure functions in `packages/shared`: the diff parser (with patch fixtures), word diff and row building, permission and approval-rule functions, suggestion patches, realtime and notification payloads.                                                                                                                                |
| Web               | `apps/web/src/lib` helpers (API client, Server Action validation and error mapping, real-time client with a fake socket, notifications store, highlighting, CSP and client IP), and components (`DiffTable`, comment threads, approval panels, AI review card, notification bell, live indicator, verify-email pages) rendered to static markup with mocks.   |
| CI                | GitHub Actions runs typecheck, lint, format check, the full test suite against PostgreSQL 18 and Redis 8 service containers, and the API and web builds on every PR and push to `main`.                                                                                                                                                                       |

### Planned

| Level      | Scope                                                                                                                        | Tooling    |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------- | ---------- |
| End-to-end | Browser flows against a running web app and API: sign up and verify, create a review, comment, approve and merge, AI review. | Playwright |
| AI eval    | A fixed set of patches with expected findings, to measure prompt and model changes.                                          | Vitest     |

---

## Contributing

Contributions and design feedback are welcome.

1. **Open an issue first** for anything non-trivial, so the approach can be discussed against the [architecture](architecture.md).
2. **Fork and branch** from `main` using a descriptive branch name (e.g. `feat/review-approvals`, `fix/comment-pagination`).
3. **Keep changes focused.** One concern per pull request.
4. **Validate at boundaries.** New endpoints and events should come with Zod schemas in `packages/shared`.
5. **Include tests** for new behaviour, including authorization failure cases.
6. **Never commit secrets** or real `.env` files.
7. **Update documentation** — including the [Current Status](roadmap.md#current-status) table — when a feature moves from Planned to In progress or Implemented.
8. Use clear commit messages (Conventional Commits are encouraged).

A `CONTRIBUTING.md` and code of conduct will be added as the project matures.
