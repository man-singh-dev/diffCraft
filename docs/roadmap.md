# Roadmap

What exists today (the detailed status table), the full development roadmap and ideas beyond it.

[← Back to README](../README.md)

---

## Current Status

| Area                                                             | Status          | Notes                                                                                                                                                                                                                                                                                            |
| ---------------------------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Repository and documentation                                     | **In progress** | This README defines scope and intended architecture, and marks what is implemented.                                                                                                                                                                                                              |
| Monorepo scaffolding (`apps/web`, `apps/api`, `packages/shared`) | **Implemented** | pnpm workspaces; shared TypeScript, ESLint and Prettier config.                                                                                                                                                                                                                                  |
| Shared package (`packages/shared`)                               | **Implemented** | Zod schemas with inferred types: health and readiness responses, auth requests, the public user, the error response shape, plus a Zod error formatter.                                                                                                                                           |
| API skeleton (Fastify)                                           | **Implemented** | Validated env config, `GET /health` (liveness), `GET /ready` (readiness, checks the database), graceful shutdown.                                                                                                                                                                                |
| Web skeleton (Next.js)                                           | **Implemented** | Home page that shows the API health status (fetched server-side) and links to log in, sign up or the profile.                                                                                                                                                                                    |
| Local infrastructure (Docker Compose)                            | **Implemented** | PostgreSQL 18 and Redis 8 for local development. The API connects to Postgres; nothing uses Redis until Stage 7.                                                                                                                                                                                 |
| CI (GitHub Actions)                                              | **Implemented** | Typecheck, lint, format check, tests (with a PostgreSQL 18 service container), API build and web build on PRs and pushes to `main`.                                                                                                                                                              |
| Tests (Vitest)                                                   | **Implemented** | Unit tests, plus API integration tests (auth routes, sessions, `/ready`, the unique email index) that run against a separate test database (`diffcraft_test`, migrated automatically before the tests; skipped if `TEST_DATABASE_URL` is unset). No coverage figures are claimed.                |
| Database layer (Drizzle)                                         | **Implemented** | Drizzle schema and migrations for the `users` and `sessions` tables, `GET /ready`. The rest of the schema in [database.md](database.md) is still a proposal.                                                                                                                                     |
| Authentication                                                   | **Implemented** | Register, login, logout and me (`/api/v1/auth/*`), with server-side sessions in HttpOnly cookies.                                                                                                                                                                                                |
| Web pages (sign-up, login, profile)                              | **Implemented** | Sign-up, login and profile pages, plus logout.                                                                                                                                                                                                                                                   |
| Deployment (Vercel + Render + Neon)                              | **Implemented** | Web on Vercel, API on Render, PostgreSQL on Neon. See [deployment.md](deployment.md).                                                                                                                                                                                                            |
| Workspaces and membership                                        | **In progress** | Done: the `workspaces` and `workspace_members` tables, the `requireWorkspaceRole` guard, the workspace endpoints (`/api/v1/workspaces`), member management with the last-owner rule (`/members`), and the web pages for both (`/workspaces`, `/workspaces/[workspaceId]`). Invitations are next. |
| Code diff viewer                                                 | Planned         |                                                                                                                                                                                                                                                                                                  |
| Reviews, comments, threads, approvals                            | Planned         |                                                                                                                                                                                                                                                                                                  |
| Real-time collaboration (Socket.IO)                              | Planned         |                                                                                                                                                                                                                                                                                                  |
| AI analysis worker (BullMQ + LLM provider)                       | Planned         |                                                                                                                                                                                                                                                                                                  |
| Application Dockerfiles                                          | Planned         | Only local Postgres and Redis run in Docker so far.                                                                                                                                                                                                                                              |
| OpenAPI documentation                                            | Planned         | To be generated from Zod route schemas.                                                                                                                                                                                                                                                          |

Status labels used throughout: **Implemented** · **In progress** · **Planned**.

---

## Development Roadmap

| Stage                             | Scope                                                                                                                                                                                                                                  | Status          |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| **0. Foundation**                 | pnpm monorepo; shared TypeScript, ESLint, Prettier and Vitest config; shared package; API and web skeletons; local Docker Compose; CI.                                                                                                 | **Implemented** |
| **1. Database and auth**          | Drizzle schema and migrations; database connection; `/ready` probe; registration, login and sessions; sign-up, login and profile pages; free-tier deployment (Vercel, Render, Neon).                                                   | **Implemented** |
| **2. Workspaces and roles**       | Workspaces, membership and invitations; role-based authorization guards.                                                                                                                                                               | **In progress** |
| **3. Reviews and diff ingestion** | Review creation from patch upload; diff parsing and storage; changed-file list; revisions. Done: the diff parser (`packages/shared/src/diff`) and the `reviews` / `review_files` tables with their service. Routes and pages are next. | In progress     |
| **4. Diff viewer**                | Unified and side-by-side diff views; file navigation; stable line references.                                                                                                                                                          | Planned         |
| **5. Comments and threads**       | Line-anchored comments, replies, resolution and outdated detection.                                                                                                                                                                    | Planned         |
| **6. Approvals and lifecycle**    | Reviewer assignment; approve / request changes; status recomputation; review history.                                                                                                                                                  | Planned         |
| **7. Real-time**                  | First use of Redis: Socket.IO with session auth and rooms; emit-after-commit; presence (Redis TTL keys); notifications; Socket.IO Redis adapter.                                                                                       | Planned         |
| **8. AI analysis**                | Job model; BullMQ queue (on Redis) and worker; provider adapter; context building and redaction; schema-validated findings; retries; findings UI.                                                                                      | Planned         |
| **9. Hardening and deployment**   | Rate limiting, security headers, end-to-end tests, Dockerfiles, multi-instance deployment, observability.                                                                                                                              | Planned         |

---

## Future Enhancements

These are ideas beyond the initial roadmap, not commitments:

- GitHub / GitLab integration to import pull requests and post findings back.
- OAuth sign-in and SSO.
- Syntax highlighting and intra-line (word-level) diff highlighting.
- Suggested-change blocks that authors can apply as patches.
- Configurable approval rules (required approvers, require all threads resolved).
- Combining AI findings with deterministic static analysis (linters, SAST) results.
- Feedback on findings (helpful / not helpful) to evaluate prompt and model changes.
- Per-workspace AI settings: enabled categories, minimum severity, provider choice, opt-out.
- Email and digest notifications.
- Full-text search across reviews and comments.
- Audit log export.
