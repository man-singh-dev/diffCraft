<div align="center">

# DiffCraft

**Collaborative Code Review and AI-Assisted Debugging Platform**

[![CI](https://github.com/man-singh-dev/diffCraft/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/man-singh-dev/diffCraft/actions/workflows/ci.yml)
![Status](https://img.shields.io/badge/status-initial%20development-orange)
![License](https://img.shields.io/badge/license-undecided-lightgrey)

**Live demo:** [diffcraft-three.vercel.app](https://diffcraft-three.vercel.app)

<sub>The API runs on a free instance that sleeps after inactivity, so the first request can take about a minute.</sub>

</div>

> [!IMPORTANT]
> **DiffCraft is in its initial development stage.** This README describes the product vision and the _intended_ architecture. Unless a section is explicitly labeled **Implemented**, the features, schema, endpoints, commands and deployment described here are **Planned** and do not yet exist in the codebase. The status table below is the source of truth and will be updated as work lands.

---

## Table of Contents

- [Current Status](#current-status)
- [Known Limitations](#known-limitations)
- [Overview](#overview)
- [Problem Statement](#problem-statement)
- [Goals and Design Principles](#goals-and-design-principles)
- [Key Features](#key-features)
- [Product Workflow](#product-workflow)
- [Screenshots](#screenshots)
- [High-Level Architecture](#high-level-architecture)
- [Component Responsibilities](#component-responsibilities)
- [Technology Stack](#technology-stack)
- [Data Flow](#data-flow)
- [Database Design](#database-design)
- [API Design](#api-design)
- [Authentication and Authorization](#authentication-and-authorization)
- [Real-Time Event Architecture](#real-time-event-architecture)
- [AI Analysis Pipeline](#ai-analysis-pipeline)
- [Background Jobs and Failure Handling](#background-jobs-and-failure-handling)
- [Security Considerations](#security-considerations)
- [Testing Strategy](#testing-strategy)
- [Local Development Setup](#local-development-setup)
- [Environment Variables](#environment-variables)
- [Docker Setup](#docker-setup)
- [Project Structure](#project-structure)
- [Deployment](#deployment)
- [Deployment Architecture](#deployment-architecture)
- [Development Roadmap](#development-roadmap)
- [Future Enhancements](#future-enhancements)
- [Contributing](#contributing)
- [License](#license)

---

## Current Status

| Area                                                             | Status          | Notes                                                                                                                                                                                                                                                                             |
| ---------------------------------------------------------------- | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Repository and documentation                                     | **In progress** | This README defines scope and intended architecture, and marks what is implemented.                                                                                                                                                                                               |
| Monorepo scaffolding (`apps/web`, `apps/api`, `packages/shared`) | **Implemented** | pnpm workspaces; shared TypeScript, ESLint and Prettier config.                                                                                                                                                                                                                   |
| Shared package (`packages/shared`)                               | **Implemented** | Zod schemas with inferred types: health and readiness responses, auth requests, the public user, the error response shape, plus a Zod error formatter.                                                                                                                            |
| API skeleton (Fastify)                                           | **Implemented** | Validated env config, `GET /health` (liveness), `GET /ready` (readiness, checks the database), graceful shutdown.                                                                                                                                                                 |
| Web skeleton (Next.js)                                           | **Implemented** | Home page that shows the API health status (fetched server-side) and links to log in, sign up or the profile.                                                                                                                                                                     |
| Local infrastructure (Docker Compose)                            | **Implemented** | PostgreSQL 18 and Redis 8 for local development. The API connects to Postgres; nothing uses Redis until Stage 7.                                                                                                                                                                  |
| CI (GitHub Actions)                                              | **Implemented** | Typecheck, lint, format check, tests (with a PostgreSQL 18 service container), API build and web build on PRs and pushes to `main`.                                                                                                                                               |
| Tests (Vitest)                                                   | **Implemented** | Unit tests, plus API integration tests (auth routes, sessions, `/ready`, the unique email index) that run against a separate test database (`diffcraft_test`, migrated automatically before the tests; skipped if `TEST_DATABASE_URL` is unset). No coverage figures are claimed. |
| Database layer (Drizzle)                                         | **Implemented** | Drizzle schema and migrations for the `users` and `sessions` tables, `GET /ready`. The rest of the schema below is still a proposal.                                                                                                                                              |
| Authentication                                                   | **Implemented** | Register, login, logout and me (`/api/v1/auth/*`), with server-side sessions in HttpOnly cookies.                                                                                                                                                                                 |
| Web pages (sign-up, login, profile)                              | **Implemented** | Sign-up, login and profile pages, plus logout.                                                                                                                                                                                                                                    |
| Deployment (Vercel + Render + Neon)                              | **Implemented** | Web on Vercel, API on Render, PostgreSQL on Neon. See [Deployment](#deployment).                                                                                                                                                                                                  |
| Workspaces and membership                                        | Planned         |                                                                                                                                                                                                                                                                                   |
| Code diff viewer                                                 | Planned         |                                                                                                                                                                                                                                                                                   |
| Reviews, comments, threads, approvals                            | Planned         |                                                                                                                                                                                                                                                                                   |
| Real-time collaboration (Socket.IO)                              | Planned         |                                                                                                                                                                                                                                                                                   |
| AI analysis worker (BullMQ + LLM provider)                       | Planned         |                                                                                                                                                                                                                                                                                   |
| Application Dockerfiles                                          | Planned         | Only local Postgres and Redis run in Docker so far.                                                                                                                                                                                                                               |
| OpenAPI documentation                                            | Planned         | To be generated from Zod route schemas.                                                                                                                                                                                                                                           |

Status labels used throughout: **Implemented** · **In progress** · **Planned**.

---

## Known Limitations

- **Cold starts.** The API runs on a free Render instance that sleeps after inactivity, so the first request after a quiet period can take about a minute.
- **No rate limiting yet.** Login and registration are not rate-limited. Rate limiting is planned (Stage 9).
- **Email enumeration on register.** `POST /api/v1/auth/register` returns `409` when the email is already registered, which reveals whether an account exists. This stays until email verification is added.
- **No custom domain yet.** The app is served from its default Vercel URL.

---

## Overview

DiffCraft is a collaborative code review platform. It is designed to help developers understand code changes, discuss potential bugs in the context of specific lines, record review decisions, and request AI-assisted analysis of the changed code — all within a single workspace.

The goal is to bring four things that are usually scattered across tools into one place:

1. **The diff** — what changed, file by file and line by line.
2. **The discussion** — threaded, line-anchored conversations about those changes.
3. **The decision** — reviewer assignments, approvals, change requests and review status.
4. **The analysis** — structured, AI-generated findings that point to specific files and lines and are reviewed by humans like any other comment.

DiffCraft is **not** an AI chatbot or a code generator. The AI component is one input into a human-led review process: it produces suggestions that reviewers verify, discuss and either act on or dismiss.

The project is also intended as a deliberate exercise in backend engineering: relational data modeling, authorization, reliable real-time updates, asynchronous job processing and safe integration of an external LLM provider.

---

## Problem Statement

Code review is where many defects are caught, but the process has recurring friction:

- **Context is fragmented.** Diffs, discussion, CI output and ad-hoc analysis often live in different tools, so reviewers spend effort reassembling context.
- **Discussion drifts from the code.** Comments that are not anchored to lines (or become stale after a new revision) are hard to follow and easy to lose.
- **Review state is ambiguous.** It is not always clear who still needs to review, which threads are unresolved, or whether a change request has been addressed.
- **Automated analysis is hard to trust and hard to act on.** Unstructured AI output ("this looks fine", or a wall of text) is difficult to verify, cannot be tracked, and is not tied to specific lines.

DiffCraft aims to address these by modeling reviews, line-anchored threads, review decisions and AI findings as first-class, related data — and by delivering updates to participants in real time.

---

## Goals and Design Principles

| Principle                                  | What it means in practice                                                                                                                        |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Humans make the decisions**              | AI findings are suggestions with a severity, category and explanation. They never approve, reject or block a review on their own.                |
| **Everything is anchored**                 | Comments and findings reference a review, a file, a revision and a line range, so they can be located and marked outdated when the code changes. |
| **The database is the source of truth**    | Real-time events are notifications about committed state, never a substitute for it. Clients can always recover by re-fetching over HTTP.        |
| **Slow work happens off the request path** | LLM calls run in a background worker. HTTP requests return quickly with a job reference.                                                         |
| **Validate at every boundary**             | Request bodies, query parameters, socket payloads, environment configuration and model output are all validated with Zod schemas.                |
| **Authorize every resource access**        | Authentication alone is not sufficient; every read and write is checked against workspace membership and role.                                   |
| **Fail visibly and recoverably**           | Jobs have explicit states, bounded retries, timeouts and recorded failure reasons.                                                               |
| **Shared contracts**                       | Request/response and event schemas live in a shared package used by both frontend and backend, reducing drift.                                   |
| **Honest documentation**                   | The README distinguishes what exists from what is planned.                                                                                       |

---

## Key Features

All features below are **Planned** unless marked otherwise. So far only user authentication is **Implemented**.

### Code Diff Viewer

- Side-by-side and unified diff views.
- Highlighting of added and removed lines.
- File-level change navigation (file tree with per-file addition/deletion counts).
- Stable line-number references (old side / new side) used by comments and AI findings.

### Collaborative Code Review

- Review sessions containing one or more changed files.
- Line-level and line-range comments.
- Threaded discussions via replies.
- Thread resolution and reopening, tracked independently of review approval.
- Approve / request-changes workflow.
- Review status tracking across revisions.

### Real-Time Collaboration

- Live comment, reply and resolution updates.
- Live review status and approval updates.
- In-app notifications (mentions, assignments, completed analyses).
- Reviewer presence indicators per review.
- Socket.IO-based transport with authorized rooms.

### AI-Assisted Code Analysis

- Potential bug detection.
- Security issue identification.
- Performance suggestions.
- Code quality feedback.
- Natural-language summaries of a change.
- Structured findings: **severity**, **category**, **explanation**, **suggested fix (optional)**, **file and line references**, and a **confidence** indicator.

> [!NOTE]
> AI findings are generated by a language model and can be incorrect, incomplete or irrelevant. They are presented as suggestions that require verification by a reviewer, not as guaranteed diagnoses. Reviewers can dismiss a finding or promote it into a discussion thread.

### Review Management

- Reviewer assignments and reassignment.
- Unresolved-thread tracking per review and per reviewer.
- Review history (status changes, approvals, revisions, analyses).
- Filters by status, author, assignee and workspace.
- Workspace-level collaboration.

### Authentication and Authorization

- User authentication: email/password sign-up, login, logout and server-side sessions. **Implemented.**
- Workspace membership with invitations.
- Role-based access control at the workspace level.
- Resource-level authorization checks on every protected endpoint and socket room.

---

## Product Workflow

```mermaid
flowchart LR
    A[Author creates review<br/>and submits diff] --> B[Reviewers assigned]
    B --> C[Reviewers read diff<br/>and comment on lines]
    A -. optional .-> D[Request AI analysis]
    D --> E[Findings appear<br/>on affected lines]
    E --> C
    C --> F{Decision}
    F -- Request changes --> G[Author submits<br/>new revision]
    G --> C
    F -- Approve --> H[Review approved]
```

1. An author creates a review in a workspace and submits a diff (initially as a unified diff / patch upload; Git provider integration is a future enhancement).
2. The author assigns reviewers. Assigned reviewers are notified in real time.
3. Reviewers navigate the diff and leave line-anchored comments; others reply in threads.
4. Any participant with permission may request an AI analysis. The request is processed in the background, and findings appear on the relevant lines once ready.
5. Reviewers resolve threads, dismiss or discuss findings, and record a decision: **approve** or **request changes**.
6. If changes are requested, the author submits a new revision. Comments on changed lines are marked outdated, and the review returns to _in review_.

---

## Screenshots

> [!NOTE]
> So far the UI has only the home, sign-up, login and profile pages (try them in the [live demo](https://diffcraft-three.vercel.app)). The review screens below don't exist yet; their placeholders will be replaced with real screenshots once they are implemented.

| Screen                                                             | Status  |
| ------------------------------------------------------------------ | ------- |
| _Placeholder:_ Review list with status filters                     | Planned |
| _Placeholder:_ Side-by-side diff with inline comment thread        | Planned |
| _Placeholder:_ AI findings panel with severity and line references | Planned |
| _Placeholder:_ Review approval / change-request panel              | Planned |

<!-- Example once available:
![Diff viewer](docs/images/diff-viewer.png)
-->

---

## High-Level Architecture

DiffCraft is designed as a small set of cooperating services sharing a PostgreSQL database and a Redis instance:

- A **Next.js frontend** that renders the diff viewer and review UI.
- A **Fastify API** that owns all reads and writes, enforces authorization and hosts the Socket.IO server.
- A **background worker** that processes AI analysis jobs from a BullMQ queue.
- **PostgreSQL** as the system of record; **Redis** as the job queue backend and Socket.IO pub/sub adapter.
- An **external LLM provider**, reachable only from the worker.

### Architecture diagram (proposed)

Solid arrows are **synchronous** request/response interactions. Dashed arrows are **asynchronous** (queued work, pub/sub, pushed events).

```mermaid
flowchart LR
    subgraph Client
        FE["Browser<br/>Next.js frontend"]
    end

    subgraph Backend
        API["Fastify REST API<br/>+ Socket.IO server"]
        WK["AI analysis worker<br/>(BullMQ consumer)"]
    end

    subgraph Data
        PG[("PostgreSQL<br/>via Drizzle ORM")]
        RD[("Redis<br/>BullMQ queues + Socket.IO adapter")]
    end

    LLM["External LLM provider"]

    FE -- "HTTPS REST (sync)" --> API
    API -- "SQL queries (sync)" --> PG
    FE <-. "WebSocket events (Socket.IO)" .-> API

    API -. "(1) enqueue analysis job" .-> RD
    RD -. "(2) job delivered" .-> WK
    WK -- "(3) load diff hunks" --> PG
    WK -- "(4) HTTPS request with timeout" --> LLM
    WK -- "(5) persist validated findings" --> PG
    WK -. "(6) publish 'analysis completed'" .-> RD
    RD -. "(7) fan-out via adapter" .-> API
    API -. "(8) emit to authorized room" .-> FE
```

**Why this shape:**

- **Fastify** gives fast request handling, a first-class plugin/encapsulation model for auth and DB decorators, and schema-driven routes that pair well with Zod and OpenAPI generation.
- **A separate worker process** keeps slow, failure-prone LLM calls off the API's event loop and allows the worker to be scaled or restarted independently.
- **BullMQ on Redis** provides durable jobs, retries with backoff, job IDs for de-duplication and visibility into failed jobs, without introducing an additional broker.
- **Socket.IO's Redis adapter** lets multiple API instances — and the worker — broadcast to the same rooms, so real-time delivery does not depend on which instance a client is connected to.
- **PostgreSQL** fits the strongly relational domain (workspaces → reviews → files → threads) and provides transactions, foreign keys, partial indexes and row locking needed for consistent review state.

---

## Component Responsibilities

| Component                                           | Responsibilities                                                                                                                                                                                                      | Does **not** do                                                    |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| **Web (`apps/web`)**                                | Rendering diffs, comment threads, findings and review state; optimistic UI where safe; subscribing to review rooms; re-fetching on reconnect.                                                                         | Authorization decisions, direct DB or LLM access, holding secrets. |
| **API (`apps/api`)**                                | Authentication, authorization, Zod validation, business rules (state transitions, approvals), persistence, enqueueing jobs, Socket.IO handshake auth and room membership, emitting events after commit, OpenAPI docs. | Calling the LLM provider; long-running work.                       |
| **Worker (`apps/worker` or API worker entrypoint)** | Consuming analysis jobs, assembling bounded prompt context from diff hunks, redacting likely secrets, calling the LLM with timeouts, validating output, persisting findings, publishing completion events.            | Serving HTTP; accepting user input directly.                       |
| **Shared (`packages/shared`)**                      | Zod schemas for requests, responses, socket events and AI findings; shared enums (roles, statuses, severities); TypeScript types inferred from schemas.                                                               | Runtime I/O.                                                       |
| **PostgreSQL**                                      | System of record for users, workspaces, reviews, comments, approvals, jobs and findings.                                                                                                                              |                                                                    |
| **Redis**                                           | BullMQ queues, Socket.IO adapter pub/sub, rate-limit counters, presence TTL keys.                                                                                                                                     | Durable business data.                                             |
| **LLM provider**                                    | Producing structured analysis from bounded diff context.                                                                                                                                                              | Being trusted: its output is validated before use.                 |

---

## Technology Stack

**In use now:** Next.js, TypeScript, Tailwind CSS, Node.js, Fastify (with `@fastify/cookie`), Zod, PostgreSQL with Drizzle ORM (schema, migrations and the `pg` driver), Argon2id (`@node-rs/argon2`), esbuild (API production bundle), Vitest, Docker (local PostgreSQL and Redis), GitHub Actions CI, and Vercel, Render and Neon for deployment.

**Planned:** Socket.IO, BullMQ, the LLM provider integration and OpenAPI generation. Redis runs locally but no application code uses it until Stage 7.

| Layer            | Technology                                    | Rationale                                                                                                            |
| ---------------- | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Frontend         | **Next.js**, **TypeScript**, **Tailwind CSS** | Component model suited to a complex review UI; type sharing with backend; utility CSS keeps diff styling consistent. |
| API              | **Node.js**, **Fastify**, **TypeScript**      | Low-overhead HTTP server with plugin encapsulation and schema-based routes.                                          |
| Validation       | **Zod**                                       | One schema definition for runtime validation, TypeScript types and OpenAPI generation; also used for LLM output.     |
| Database         | **PostgreSQL**                                | Relational integrity, transactions, partial/compound indexes, `SELECT … FOR UPDATE`.                                 |
| ORM / migrations | **Drizzle ORM**                               | Typed, SQL-close query builder with parameterized queries and versioned migrations.                                  |
| Real-time        | **Socket.IO**                                 | Rooms, acknowledgements, reconnection handling and a Redis adapter for multi-instance fan-out.                       |
| Background jobs  | **Redis**, **BullMQ**                         | Durable queues, retries with backoff, job de-duplication by ID, concurrency control.                                 |
| AI               | Server-side LLM provider integration          | Provider abstracted behind an interface so models/providers can be swapped and mocked in tests.                      |
| Testing          | **Vitest**                                    | Fast TypeScript-native test runner for unit and integration tests.                                                   |
| API docs         | **OpenAPI**                                   | Generated from route schemas so documentation tracks the code.                                                       |
| Infrastructure   | **Docker**, **GitHub Actions**                | Reproducible local services and automated checks.                                                                    |

---

## Data Flow

### Synchronous path — reading and writing review data

1. The browser calls the API over HTTPS with a session cookie.
2. Fastify's auth plugin resolves the user; a route-level guard loads the target resource and checks workspace membership and role.
3. The request is validated with Zod.
4. Drizzle executes parameterized queries in a transaction when multiple rows change.
5. After commit, the API emits a Socket.IO event to the relevant room and returns the HTTP response.

### Asynchronous path — AI analysis

1. A client requests analysis; the API validates input and permissions.
2. The API inserts an `ai_analysis_jobs` row (status `queued`) and enqueues a BullMQ job whose ID is derived from the job's idempotency key.
3. The API returns `202 Accepted` with the job ID.
4. The worker loads the relevant diff hunks, calls the LLM provider, validates the response, and writes findings and the job's final status in one transaction.
5. The worker publishes a completion event; the API's Socket.IO adapter delivers it to authorized clients, which then fetch findings over HTTP.

### Recovery path

On reconnect, the client re-joins its rooms and re-fetches the review state over HTTP. Events are treated as hints to refresh rather than as the only copy of the data, so missed events do not cause permanent inconsistency.

---

## Database Design

> [!NOTE]
> **Implemented:** the `users` and `sessions` tables (Drizzle schema in `apps/api/src/db/schema`, migrations in `apps/api/drizzle`). Every other table below is a **proposal**. It will change during implementation and will not be considered final until it exists as Drizzle schema and migrations.

### Entity-relationship diagram (`users` and `sessions` implemented; the rest proposed)

```mermaid
erDiagram
    users ||--o{ sessions : "has"
    users ||--o{ workspace_members : "has"
    workspaces ||--o{ workspace_members : "has"
    workspaces ||--o{ reviews : "contains"
    users ||--o{ reviews : "authors"
    reviews ||--|{ review_files : "includes"
    reviews ||--o{ review_comments : "has"
    review_files ||--o{ review_comments : "anchors"
    users ||--o{ review_comments : "writes"
    review_comments |o--o{ review_comments : "parent of"
    reviews ||--o{ review_approvals : "receives"
    users ||--o{ review_approvals : "submits"
    reviews ||--o{ ai_analysis_jobs : "has"
    users ||--o{ ai_analysis_jobs : "requests"
    ai_analysis_jobs ||--o{ ai_findings : "produces"
    reviews ||--o{ ai_findings : "has"
    review_files |o--o{ ai_findings : "located in"

    users {
        uuid id PK "uuidv7()"
        text email UK "unique on lower(email)"
        text display_name
        text password_hash
        timestamptz created_at
        timestamptz updated_at
    }
    sessions {
        text id PK "SHA-256 of the session token"
        uuid user_id FK
        timestamptz created_at
        timestamptz expires_at
        timestamptz last_used_at
    }
    workspaces {
        uuid id PK
        text name
        text slug UK
        uuid created_by FK
        timestamptz created_at
    }
    workspace_members {
        uuid workspace_id PK, FK
        uuid user_id PK, FK
        text role "owner | admin | member | viewer"
        timestamptz joined_at
    }
    reviews {
        uuid id PK
        uuid workspace_id FK
        uuid author_id FK
        text title
        text description
        text status "open | in_review | changes_requested | approved | closed"
        int current_revision
        int version "optimistic lock"
        timestamptz created_at
        timestamptz updated_at
    }
    review_files {
        uuid id PK
        uuid review_id FK
        int revision
        text old_path
        text new_path
        text change_type "added | modified | deleted | renamed"
        text patch
        int additions
        int deletions
    }
    review_comments {
        uuid id PK
        uuid review_id FK
        uuid review_file_id FK "null for review-level comments"
        uuid parent_comment_id FK "null for thread root"
        uuid author_id FK
        int revision
        text side "old | new"
        int line_start
        int line_end
        text body
        boolean is_outdated
        timestamptz resolved_at
        uuid resolved_by FK
        timestamptz created_at
        timestamptz deleted_at
    }
    review_approvals {
        uuid id PK
        uuid review_id FK
        uuid reviewer_id FK
        int revision
        text decision "approved | changes_requested"
        text note
        timestamptz created_at
    }
    ai_analysis_jobs {
        uuid id PK
        uuid review_id FK
        uuid requested_by FK
        int revision
        text analysis_type
        text idempotency_key UK
        text status "queued | running | succeeded | failed | cancelled"
        int attempts
        text error_code
        text model
        text prompt_version
        timestamptz created_at
        timestamptz finished_at
    }
    ai_findings {
        uuid id PK
        uuid job_id FK
        uuid review_id FK
        uuid review_file_id FK "nullable"
        text side "old | new, nullable"
        int line_start "nullable"
        int line_end "nullable"
        text severity "info | low | medium | high | critical"
        text category "bug | security | performance | quality"
        text title
        text explanation
        text suggestion
        real confidence
        text status "open | dismissed | converted_to_comment"
        timestamptz created_at
    }
```

### Table responsibilities

| Table               | Responsibility                                                                                                                          |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `users`             | Identity and credentials (password hash only; never plaintext). **Implemented.**                                                        |
| `sessions`          | Server-side sessions. Stores only a SHA-256 hash of each token, with a 7-day absolute expiry. Cascades on user delete. **Implemented.** |
| `workspaces`        | Top-level tenancy boundary. Every review belongs to exactly one workspace.                                                              |
| `workspace_members` | Join table between users and workspaces carrying the member's **role**. The basis for authorization.                                    |
| `reviews`           | A unit of review: title, author, status, current revision and an optimistic-lock `version`.                                             |
| `review_files`      | Per-file changes for a given revision, including paths, change type, the unified patch and line counts.                                 |
| `review_comments`   | Line-anchored or review-level comments. `parent_comment_id` (self-reference) forms threads; resolution is stored on the thread root.    |
| `review_approvals`  | Reviewer decisions per revision (`approved` / `changes_requested`). A new revision invalidates earlier decisions by default.            |
| `ai_analysis_jobs`  | Lifecycle and audit record for each analysis request: status, attempts, error code, model and prompt version.                           |
| `ai_findings`       | Structured findings from a job, linked to the review and — when applicable — a specific file, side and line range.                      |

Reviewer assignment and notifications will likely require additional tables (`review_reviewers`, `notifications`), which are included in the roadmap.

### Foreign keys and referential integrity

- All relationships are enforced with foreign keys; application code does not rely on "soft" references.
- `ON DELETE CASCADE` from `reviews` to `review_files`, `review_comments`, `review_approvals`, `ai_analysis_jobs` and `ai_findings`, so deleting a review cannot leave orphans.
- `ON DELETE RESTRICT` (or soft-delete) for `users` referenced as authors, so history is not silently lost.
- Comments use soft deletion (`deleted_at`) so that replies in a thread remain coherent.
- `CHECK` constraints: `line_end >= line_start`; line fields are either all null or all set; `parent_comment_id <> id`.
- Replies must belong to the same review as their parent; enforced in the service layer (and optionally by a composite foreign key on `(review_id, parent_comment_id)`).

### Unique constraints

| Constraint                                               | Purpose                                                                                 |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `users(lower(email))`                                    | One account per email address, case-insensitive. **Implemented.**                       |
| `workspaces(slug)`                                       | Stable, unique URLs.                                                                    |
| `workspace_members(workspace_id, user_id)` (primary key) | A user has exactly one role per workspace.                                              |
| `review_files(review_id, revision, new_path)`            | No duplicate file entries within a revision.                                            |
| `review_approvals(review_id, reviewer_id, revision)`     | One decision per reviewer per revision (updates replace it).                            |
| `ai_analysis_jobs(idempotency_key)`                      | Prevents duplicate jobs for the same review revision, analysis type and prompt version. |

### Indexes for common access patterns

| Access pattern                                      | Index                                                                                                                     |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| List reviews in a workspace by status, newest first | `reviews(workspace_id, status, updated_at DESC, id)`                                                                      |
| "My reviews"                                        | `reviews(author_id, updated_at DESC)`                                                                                     |
| Load all comments for a review                      | `review_comments(review_id, created_at, id)`                                                                              |
| Load comments for a file in the diff viewer         | `review_comments(review_file_id, line_start)`                                                                             |
| Load replies for a thread                           | `review_comments(parent_comment_id)`                                                                                      |
| Count unresolved threads                            | Partial index `review_comments(review_id) WHERE parent_comment_id IS NULL AND resolved_at IS NULL AND deleted_at IS NULL` |
| Latest decisions                                    | `review_approvals(review_id, revision)`                                                                                   |
| Active analysis jobs                                | Partial index `ai_analysis_jobs(review_id) WHERE status IN ('queued','running')`                                          |
| Findings for a file                                 | `ai_findings(review_file_id, line_start)`                                                                                 |
| Workspaces for a user                               | `workspace_members(user_id)`                                                                                              |

### Transactions

Operations that change more than one row run in a single transaction, for example:

- **Submitting a decision:** insert/update `review_approvals`, recompute and update `reviews.status`, bump `reviews.version`.
- **Submitting a new revision:** insert new `review_files`, increment `current_revision`, mark comments on changed lines `is_outdated`, set status back to `in_review`.
- **Completing an analysis:** insert all `ai_findings` and set the job to `succeeded` atomically, so clients never see a "succeeded" job with partial findings.

### Concurrency

- **Optimistic locking** on `reviews.version`: state-changing requests include the version they read, and the update uses `WHERE id = $1 AND version = $2`. A zero-row update returns `409 Conflict`, and the client re-fetches.
- **Row locks** (`SELECT … FOR UPDATE` on the review row) for status recomputation, so two simultaneous decisions cannot produce an inconsistent status.
- Thread resolution is idempotent: resolving an already-resolved thread is a no-op.

### Pagination

List endpoints use **keyset (cursor) pagination** on `(created_at, id)` or `(updated_at, id)` rather than `OFFSET`, which keeps page cost stable on large tables and avoids skipped or duplicated rows when new comments arrive while paging. Cursors are opaque, encoded tokens; page size is bounded server-side.

---

## API Design

> [!NOTE]
> **All endpoints below are proposed** unless marked **Implemented** (so far the four authentication endpoints, `GET /health` and `GET /ready`). Paths, payloads and semantics may change. Once implemented, the OpenAPI document generated from route schemas will be authoritative.

Conventions (the base path, error shape, `401` and `422` are **Implemented**; the rest are proposed):

- Base path `/api/v1`; JSON request and response bodies.
- Errors use a consistent shape: `{ "error": { "code": "...", "message": "...", "details": {...} } }` (`ErrorResponseSchema` in `packages/shared`; unexpected errors become a generic `500 internal_error`).
- `401` when unauthenticated; `403` when authenticated but not permitted; `404` when the resource does not exist **or** the caller cannot see it (to avoid leaking existence across workspaces).
- `409` for optimistic-lock conflicts and invalid state transitions; `422` for validation failures; `429` for rate limits.
- List endpoints accept `?cursor=` and `?limit=`.

**Auth column legend:** _Public_ = no session required · _User_ = any authenticated user · _Member_ = member of the workspace that owns the resource · _Admin_ = workspace owner or admin · _Author_ = review author · _Participant_ = review author or assigned reviewer.

### Authentication

| Method | Path                    | Purpose                                    | Auth                                | Status          |
| ------ | ----------------------- | ------------------------------------------ | ----------------------------------- | --------------- |
| `POST` | `/api/v1/auth/register` | Create an account.                         | Public (rate limiting planned)      | **Implemented** |
| `POST` | `/api/v1/auth/login`    | Start a session (sets an HttpOnly cookie). | Public (rate limiting planned)      | **Implemented** |
| `POST` | `/api/v1/auth/logout`   | End the current session.                   | Public (clears the session, if any) | **Implemented** |
| `GET`  | `/api/v1/auth/me`       | Return the current user.                   | User                                | **Implemented** |

### Workspaces and membership

| Method   | Path                                              | Purpose                                     | Auth                              |
| -------- | ------------------------------------------------- | ------------------------------------------- | --------------------------------- |
| `GET`    | `/api/v1/workspaces`                              | List workspaces the user belongs to.        | User                              |
| `POST`   | `/api/v1/workspaces`                              | Create a workspace (creator becomes owner). | User                              |
| `GET`    | `/api/v1/workspaces/:workspaceId`                 | Get workspace details.                      | Member                            |
| `PATCH`  | `/api/v1/workspaces/:workspaceId`                 | Update workspace settings.                  | Admin                             |
| `DELETE` | `/api/v1/workspaces/:workspaceId`                 | Delete a workspace.                         | Owner                             |
| `GET`    | `/api/v1/workspaces/:workspaceId/members`         | List members and roles.                     | Member                            |
| `POST`   | `/api/v1/workspaces/:workspaceId/members`         | Invite or add a member with a role.         | Admin                             |
| `PATCH`  | `/api/v1/workspaces/:workspaceId/members/:userId` | Change a member's role.                     | Admin (owner role changes: Owner) |
| `DELETE` | `/api/v1/workspaces/:workspaceId/members/:userId` | Remove a member (or leave).                 | Admin, or the member themself     |

### Reviews

| Method  | Path                                      | Purpose                                                            | Auth                |
| ------- | ----------------------------------------- | ------------------------------------------------------------------ | ------------------- |
| `GET`   | `/api/v1/workspaces/:workspaceId/reviews` | List reviews with filters (`status`, `author`, `assignee`).        | Member              |
| `POST`  | `/api/v1/workspaces/:workspaceId/reviews` | Create a review with an initial diff.                              | Member (not viewer) |
| `GET`   | `/api/v1/reviews/:reviewId`               | Get review details, status, reviewers and unresolved-thread count. | Member              |
| `PATCH` | `/api/v1/reviews/:reviewId`               | Update title/description, or close/reopen. Requires `version`.     | Author or Admin     |
| `POST`  | `/api/v1/reviews/:reviewId/revisions`     | Submit a new revision (new diff).                                  | Author              |
| `GET`   | `/api/v1/reviews/:reviewId/history`       | Status changes, decisions, revisions and analyses over time.       | Member              |
| `PUT`   | `/api/v1/reviews/:reviewId/reviewers`     | Set assigned reviewers.                                            | Author or Admin     |

### Review files and diffs

| Method | Path                                           | Purpose                                                               | Auth   |
| ------ | ---------------------------------------------- | --------------------------------------------------------------------- | ------ |
| `GET`  | `/api/v1/reviews/:reviewId/files`              | List changed files for a revision (`?revision=`) with counts.         | Member |
| `GET`  | `/api/v1/reviews/:reviewId/files/:fileId/diff` | Get parsed hunks for one file (supports unified and split rendering). | Member |

### Comments and replies

| Method   | Path                                  | Purpose                                                     | Auth                    |
| -------- | ------------------------------------- | ----------------------------------------------------------- | ----------------------- |
| `GET`    | `/api/v1/reviews/:reviewId/comments`  | List threads (filters: `fileId`, `unresolved`, `revision`). | Member                  |
| `POST`   | `/api/v1/reviews/:reviewId/comments`  | Start a thread on a file/line range or the review.          | Member (not viewer)     |
| `POST`   | `/api/v1/comments/:commentId/replies` | Reply to a thread.                                          | Member (not viewer)     |
| `PATCH`  | `/api/v1/comments/:commentId`         | Edit own comment.                                           | Comment author          |
| `DELETE` | `/api/v1/comments/:commentId`         | Soft-delete a comment.                                      | Comment author or Admin |

### Comment resolution

| Method | Path                                    | Purpose                                           | Auth                         |
| ------ | --------------------------------------- | ------------------------------------------------- | ---------------------------- |
| `POST` | `/api/v1/comments/:commentId/resolve`   | Resolve a thread (root comment only; idempotent). | Participant or thread author |
| `POST` | `/api/v1/comments/:commentId/unresolve` | Reopen a resolved thread.                         | Participant or thread author |

### Review approvals

| Method | Path                                  | Purpose                                                                                                  | Auth              |
| ------ | ------------------------------------- | -------------------------------------------------------------------------------------------------------- | ----------------- |
| `GET`  | `/api/v1/reviews/:reviewId/approvals` | List decisions for the current (or given) revision.                                                      | Member            |
| `POST` | `/api/v1/reviews/:reviewId/approvals` | Submit `approved` or `changes_requested` with an optional note. Authors cannot approve their own review. | Assigned reviewer |

### AI analysis and findings

| Method  | Path                                  | Purpose                                                                                              | Auth                              |
| ------- | ------------------------------------- | ---------------------------------------------------------------------------------------------------- | --------------------------------- |
| `POST`  | `/api/v1/reviews/:reviewId/analyses`  | Request an analysis; returns `202` with a job ID, or the existing job if an identical one is active. | Member (not viewer), rate-limited |
| `GET`   | `/api/v1/reviews/:reviewId/analyses`  | List analysis jobs and their statuses.                                                               | Member                            |
| `GET`   | `/api/v1/analyses/:jobId`             | Get one job's status, attempts and error code.                                                       | Member                            |
| `POST`  | `/api/v1/analyses/:jobId/cancel`      | Cancel a queued job.                                                                                 | Requester or Admin                |
| `GET`   | `/api/v1/reviews/:reviewId/findings`  | List findings (filters: `severity`, `category`, `fileId`, `status`).                                 | Member                            |
| `PATCH` | `/api/v1/findings/:findingId`         | Dismiss or reopen a finding.                                                                         | Participant                       |
| `POST`  | `/api/v1/findings/:findingId/comment` | Convert a finding into a discussion thread on the same lines.                                        | Participant                       |

### Operational

| Method | Path      | Purpose                                                                                                                  | Auth              | Status          |
| ------ | --------- | ------------------------------------------------------------------------------------------------------------------------ | ----------------- | --------------- |
| `GET`  | `/health` | Liveness probe. Never touches the database.                                                                              | Public            | **Implemented** |
| `GET`  | `/ready`  | Readiness probe: `200 {"status":"ready"}` or `503 {"status":"not_ready"}`. Checks the database now; Redis will be added. | Public / internal | **Implemented** |
| `GET`  | `/docs`   | OpenAPI UI (disabled or protected outside development).                                                                  | Development       | Planned         |

---

## Authentication and Authorization

> Status: **Implemented** for authentication (Stage 1). Workspace roles and authorization guards are **Planned** (Stage 2).

### Authentication (Implemented)

Code: `apps/api/src/modules/auth` and `apps/api/src/plugins/csrf.ts`.

- **Passwords** are hashed with Argon2id (`@node-rs/argon2`). Sign-up requires 10–128 characters; emails are trimmed and lowercased.
- **Server-side sessions.** Login creates a random 256-bit token. The browser gets the raw token in a cookie; the `sessions` table stores only its SHA-256 hash, so a database leak does not expose usable tokens. Logout deletes the session row, so sessions can be revoked server-side.
- **Session cookie** `diffcraft_session`: `HttpOnly`, `SameSite=Lax`, `Path=/`, and `Secure` in production. Nothing is kept in browser-accessible storage.
- **7-day absolute expiry.** A session ends 7 days after login however much it is used; an expired session is deleted when it is next presented.
- **CSRF Origin check.** `POST`, `PUT`, `PATCH` and `DELETE` requests whose `Origin` header doesn't match `WEB_ORIGIN` are rejected with `403`. Together with `SameSite=Lax` this blocks cross-site form posts.
- **Timing-safe login.** An unknown email and a wrong password return the same `401 invalid_credentials`, and Argon2 verification runs against a dummy hash when the email is unknown, so response time does not reveal whether an account exists.
- **Session fixation defence.** Login always issues a new session and deletes any session the browser already had.
- **Same-origin cookies.** The browser only calls relative `/api/...` URLs on the web app, and Next.js rewrites them to the API, so there is no CORS and the cookie belongs to the web app's origin.
- **Not yet:** login and registration are **not rate-limited** (planned, Stage 9), and registration reveals whether an email is taken (`409`) until email verification is added. See [Known Limitations](#known-limitations).
- OAuth sign-in (e.g. GitHub) is a future enhancement.

### Authorization model (Planned, Stage 2)

Authorization is evaluated in two layers:

**1. Workspace role** (stored in `workspace_members.role`)

| Capability                                | Owner | Admin | Member | Viewer |
| ----------------------------------------- | :---: | :---: | :----: | :----: |
| View reviews, comments, findings          |   ✓   |   ✓   |   ✓    |   ✓    |
| Create reviews, comment, request analysis |   ✓   |   ✓   |   ✓    |   —    |
| Manage members and roles                  |   ✓   |   ✓   |   —    |   —    |
| Delete the workspace / transfer ownership |   ✓   |   —   |   —    |   —    |

**2. Review relationship** (author, assigned reviewer)

- Only **assigned reviewers** can submit approval decisions; an **author** cannot approve their own review.
- Only the **author** can submit new revisions.
- Comment edits are limited to the comment's author.

### Enforcement (Planned, Stage 2)

Today the only guard is `requireAuth`, which returns `401` without a valid session (used by `GET /api/v1/auth/me`).

- Every protected route resolves the target resource **with its workspace** and checks membership before any other logic — never trusting a `workspaceId` supplied by the client alone.
- Authorization is implemented as reusable Fastify `preHandler` guards, so routes cannot accidentally skip it.
- Socket.IO connections authenticate at handshake using the same session; joining a review room re-checks membership. Membership changes cause the server to remove sockets from rooms.
- Resources the caller cannot access return `404` to avoid revealing their existence.

---

## Real-Time Event Architecture

> Status: **Planned**.

### Rooms

| Room                      | Members                                  | Typical events                                              |
| ------------------------- | ---------------------------------------- | ----------------------------------------------------------- |
| `user:{userId}`           | All of a user's connections              | Notifications, assignment events                            |
| `workspace:{workspaceId}` | Authorized members viewing the workspace | Review created, review status changed                       |
| `review:{reviewId}`       | Authorized members viewing the review    | Comments, resolutions, approvals, presence, analysis status |

### Events (proposed)

| Event                                                     | Direction       | Payload (summary)                  |
| --------------------------------------------------------- | --------------- | ---------------------------------- |
| `review:join` / `review:leave`                            | Client → Server | `reviewId` (authorized on join)    |
| `comment:created` / `comment:updated` / `comment:deleted` | Server → Client | Comment DTO                        |
| `thread:resolved` / `thread:reopened`                     | Server → Client | Thread ID, actor                   |
| `review:status_changed`                                   | Server → Client | Review ID, status, version         |
| `approval:submitted`                                      | Server → Client | Reviewer, decision, revision       |
| `analysis:status_changed`                                 | Server → Client | Job ID, status                     |
| `analysis:completed`                                      | Server → Client | Job ID, finding count by severity  |
| `presence:update`                                         | Server → Client | Users currently viewing the review |
| `notification:new`                                        | Server → Client | Notification DTO                   |

All payloads are defined as Zod schemas in `packages/shared` and validated on both sides.

### Design rules

- **Writes go through HTTP, not sockets.** Mutations use REST endpoints so they share validation, authorization, rate limiting and error handling. Sockets carry notifications only (plus join/leave and presence).
- **Emit after commit.** Events are emitted only after the database transaction succeeds. A failed write never produces a success event.
- **Events are hints.** Each event carries IDs and a `version` so clients can detect gaps; on reconnect clients re-fetch state over HTTP.
- **Presence is ephemeral.** Presence uses Redis keys with a short TTL refreshed by heartbeats, so disconnected users disappear without explicit cleanup.
- **Multi-instance ready.** The Socket.IO Redis adapter lets any API instance — or the worker, via an emitter — broadcast to a room.
- A transactional outbox (writing events to a table in the same transaction and publishing them afterwards) is a candidate improvement if at-least-once delivery becomes necessary.

### Comment broadcast sequence (proposed)

```mermaid
sequenceDiagram
    autonumber
    actor R as Reviewer (browser)
    participant API as Fastify API
    participant DB as PostgreSQL
    participant IO as Socket.IO server
    actor O as Other participants

    R->>API: POST /reviews/:id/comments (body, file, lines)
    API->>API: Authenticate session, validate with Zod
    API->>DB: Load review + check workspace membership and role
    alt Not authorized or invalid input
        API-->>R: 403 / 404 / 422 (no event emitted)
    else Authorized
        API->>DB: BEGIN, INSERT review_comments, COMMIT
        alt Database error
            DB-->>API: Error / rollback
            API-->>R: 500 (no event emitted)
        else Commit succeeded
            DB-->>API: Committed row
            API-->>R: 201 Created (comment DTO)
            API->>IO: emit "comment:created" to room review:{id}
            IO-->>O: comment:created (only sockets authorized for this review)
            O->>O: Insert comment into thread in UI
        end
    end
```

---

## AI Analysis Pipeline

> Status: **Planned**. The provider is intentionally abstracted; no specific provider or model is committed to yet.

### Pipeline stages

1. **Request.** The API validates the request (analysis type, revision, optional file subset) and the caller's permission.
2. **De-duplication.** An idempotency key `hash(review_id, revision, analysis_type, file_set, prompt_version)` is computed. If a `queued`/`running` or recent `succeeded` job exists with that key, it is returned instead of creating a new one.
3. **Job creation.** A row is inserted into `ai_analysis_jobs` and a BullMQ job is enqueued with `jobId = idempotency_key`.
4. **Context assembly (worker).** The worker loads diff hunks for the revision, includes limited surrounding context, and enforces a size budget. Large reviews are split into per-file or per-chunk calls.
5. **Redaction.** Likely secrets (API key patterns, private keys, `.env`-style assignments) are masked before anything leaves the system.
6. **Model call.** The provider is called server-side with a timeout, using a prompt that requests JSON conforming to a schema. Submitted code is framed as **untrusted data**, not instructions.
7. **Output validation.** The response is parsed and validated with a Zod schema. Each finding's file and line range must map to lines present in the analyzed diff; findings that do not are dropped or attached at review level and flagged.
8. **Persistence.** Findings and the job's final status are written in one transaction.
9. **Notification.** An `analysis:completed` event is published to the review room; clients fetch findings over HTTP.

### Finding schema (proposed)

```ts
// packages/shared/src/ai/finding.ts  (proposed — not yet implemented)
import { z } from 'zod';

export const AiFinding = z.object({
  category: z.enum(['bug', 'security', 'performance', 'quality']),
  severity: z.enum(['info', 'low', 'medium', 'high', 'critical']),
  title: z.string().min(1).max(200),
  explanation: z.string().min(1).max(4000),
  suggestion: z.string().max(4000).optional(),
  file: z.string().optional(), // path as it appears in the diff
  side: z.enum(['old', 'new']).optional(),
  lineStart: z.number().int().positive().optional(),
  lineEnd: z.number().int().positive().optional(),
  confidence: z.number().min(0).max(1),
});

export const AiAnalysisResult = z.object({
  summary: z.string().max(4000),
  findings: z.array(AiFinding).max(100),
});
```

### Analysis sequence (proposed)

```mermaid
sequenceDiagram
    autonumber
    actor U as User
    participant API as Fastify API
    participant DB as PostgreSQL
    participant Q as Redis / BullMQ
    participant W as AI worker
    participant LLM as LLM provider
    participant IO as Socket.IO

    U->>API: POST /reviews/:id/analyses
    API->>API: Validate request (Zod) and check permissions
    alt Invalid or forbidden
        API-->>U: 422 / 403 / 404
    else Identical job already active
        API->>DB: Find job by idempotency key
        API-->>U: 200 existing job ID
    else New request
        API->>DB: INSERT ai_analysis_jobs (status = queued)
        API->>Q: Enqueue job (jobId = idempotency key)
        API-->>U: 202 Accepted (job ID)
        API->>IO: analysis:status_changed (queued)
    end

    Q->>W: Deliver job
    W->>DB: Set status = running, load diff hunks for revision
    W->>W: Build bounded context and redact likely secrets

    loop Attempts with exponential backoff (bounded)
        W->>LLM: Analysis request (with timeout)
        alt Timeout or retryable provider error (429 / 5xx / network)
            LLM-->>W: Error or no response
            W->>DB: Increment attempts, record error code
            Note over W,Q: Job re-queued with backoff until max attempts
        else Non-retryable provider error (4xx, auth, content rejected)
            LLM-->>W: Error
            W->>DB: Set status = failed (error_code)
            W->>IO: analysis:status_changed (failed)
        else Response received
            LLM-->>W: Model output
            W->>W: Parse JSON and validate against schema
            alt Invalid model output
                W->>W: Single repair attempt, then treat as failed attempt
                W->>DB: Record error_code = invalid_output
            else Valid output
                W->>W: Map findings to diff lines, drop unmappable references
                W->>DB: BEGIN, INSERT ai_findings, set status = succeeded, COMMIT
                W->>IO: analysis:completed (via Redis adapter)
                IO-->>U: Notify authorized clients in review room
                U->>API: GET /reviews/:id/findings
            end
        end
    end

    opt Max attempts exhausted
        W->>DB: Set status = failed (last error code)
        W->>IO: analysis:status_changed (failed)
    end
```

### Presentation in the UI

- Findings are visually distinct from human comments and labeled as AI-generated.
- Each finding shows severity, category, explanation and confidence, and links to its lines.
- Reviewers can **dismiss** a finding or **convert it into a thread**, at which point it is discussed and resolved like any other comment.
- Findings never change review status.

---

## Background Jobs and Failure Handling

> Status: **Planned**.

| Concern                          | Approach                                                                                                                                             |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Job states**                   | `queued → running → succeeded \| failed`, plus `cancelled`. The DB row is the user-visible status; BullMQ state is the execution mechanism.          |
| **Timeouts**                     | Each LLM call has a hard client-side timeout; each job has an overall time budget.                                                                   |
| **Retries**                      | Bounded attempts with exponential backoff and jitter for transient errors (timeouts, `429`, `5xx`, network errors).                                  |
| **Non-retryable errors**         | Authentication/configuration errors, request too large, content rejected, and repeated invalid output fail immediately with an `error_code`.         |
| **Duplicate prevention**         | Unique `idempotency_key` in the database plus BullMQ `jobId` de-duplication.                                                                         |
| **Idempotent completion**        | Findings for a job are written in the same transaction that marks it `succeeded`; a retried job first deletes any partial findings for that job ID.  |
| **Stalled jobs**                 | BullMQ stalled-job detection re-queues jobs whose worker died; the worker's status update is conditional on the current status to avoid regressions. |
| **Concurrency and cost control** | Worker concurrency limit, a per-workspace rate limit on analysis requests and a maximum diff size per analysis.                                      |
| **Observability**                | Structured logs with job ID, review ID, attempt, duration and error code — never including source code or prompts. Failed jobs remain inspectable.   |
| **Graceful shutdown**            | The worker stops accepting jobs and finishes or releases in-flight jobs on `SIGTERM`.                                                                |

---

## Review Lifecycle

Review status and comment resolution are **independent**. Resolving every thread does not approve a review, and approving a review does not resolve threads (although a workspace setting could later require all threads to be resolved before approval).

### Review status (proposed)

```mermaid
stateDiagram-v2
    [*] --> open: Review created
    open --> in_review: Reviewers assigned / first review activity
    in_review --> changes_requested: A reviewer requests changes
    in_review --> approved: Required approvals received
    changes_requested --> in_review: Author submits new revision
    approved --> in_review: New revision submitted (approvals reset)
    open --> closed: Author or admin closes
    in_review --> closed: Author or admin closes
    changes_requested --> closed: Author or admin closes
    approved --> closed: Completed / archived
    closed --> open: Reopened
    closed --> [*]

    state "open" as open
    state "in review" as in_review
    state "changes requested" as changes_requested
    state "approved" as approved
    state "closed" as closed
```

### Comment thread state (separate lifecycle)

```mermaid
stateDiagram-v2
    [*] --> unresolved: Thread started
    unresolved --> resolved: Resolve
    resolved --> unresolved: Reopen or new reply
    unresolved --> outdated: Anchored lines changed in new revision
    outdated --> resolved: Resolve
    resolved --> [*]
```

Status recomputation rules (proposed):

- Any `changes_requested` decision on the current revision → `changes_requested`.
- Otherwise, the required number of `approved` decisions on the current revision → `approved`.
- A new revision resets decisions (they remain in history) and moves the review to `in_review`.

---

## Security Considerations

> Rows marked **Implemented** exist in the code and have tests. The rest are **design goals**. No security audit has been done, and no security guarantees are claimed.

| Area                         | Safeguard                                                                                                                                                                                                                      | Status             |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------ |
| Authentication               | Argon2id password hashing; hashed session tokens; HttpOnly/SameSite=Lax cookies (Secure in production); session revocation on logout; CSRF Origin check; timing-safe login. See [Authentication](#authentication-implemented). | **Implemented**    |
| Resource-level authorization | Membership and role checks on every route and socket room, with resources loaded through their workspace.                                                                                                                      | Planned            |
| Input validation             | Zod schemas for auth request bodies and environment variables (**Implemented**; unknown fields are currently stripped, not rejected). Params, query strings and socket payloads are added with their routes.                   | Partly implemented |
| SQL injection                | All queries through Drizzle's parameterized query builder; no string-concatenated SQL.                                                                                                                                         | **Implemented**    |
| Rate limiting                | Per-IP and per-user limits (e.g. `@fastify/rate-limit` backed by Redis), stricter on auth and analysis endpoints. **Nothing is rate-limited yet.**                                                                             | Planned            |
| Submitted code               | Treated strictly as text: never executed, compiled or evaluated. Size limits on patches and files. Rendered with escaping (no `dangerouslySetInnerHTML` for code or comments).                                                 | Planned            |
| Prompt injection             | Code is passed to the model as delimited, untrusted data; model output cannot trigger actions and is validated against a schema before storage.                                                                                | Planned            |
| Secret disclosure            | `.env` files git-ignored, secrets loaded from environment only, and config errors list variable names, never values (**Implemented**). Redaction before LLM calls and logs that exclude code and prompts come later.           | Partly implemented |
| LLM API keys                 | Stored only server-side (worker environment); never sent to the browser or exposed via `NEXT_PUBLIC_*` variables.                                                                                                              | Planned            |
| AI request safety            | Timeouts, bounded retries, cost and size limits per request and workspace.                                                                                                                                                     | Planned            |
| Duplicate jobs               | Database-level unique idempotency key plus queue-level job IDs.                                                                                                                                                                | Planned            |
| Concurrent updates           | Optimistic locking on reviews, row locks for status recomputation, idempotent resolution.                                                                                                                                      | Planned            |
| Transport and headers        | HTTPS in deployment (Vercel and Render) and no CORS needed, since the browser only talks to the web app's origin (**Implemented**). Security headers (e.g. `@fastify/helmet`) come later.                                      | Partly implemented |
| Information leakage          | Generic `500` messages to clients with details only in server logs, and one error for unknown email or wrong password (**Implemented**). `404` for inaccessible resources comes with authorization.                            | Partly implemented |

---

## Testing Strategy

> Status: **Implemented** for the levels marked below; the rest are **Planned**. No coverage figures are claimed.

All tests use Vitest, sit next to the file they test (`*.test.ts`), and run with `pnpm test` from the root. The API's Vitest global setup migrates the separate `diffcraft_test` database first. Tests that need it are skipped when `TEST_DATABASE_URL` is unset.

### Exists now

| Level             | What is covered today                                                                                                                                                        |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit              | API config validation, logger, password hashing, error handler, CSRF Origin check.                                                                                           |
| API integration   | Auth routes, sessions and the auth service, `/health`, `/ready` and the unique email index, exercised with Fastify's `inject` against a real PostgreSQL test database.       |
| Schema / contract | Shared Zod schemas in `packages/shared` (health, readiness, auth requests and responses, the Zod error formatter).                                                           |
| Web helpers       | `apps/web/src/lib`: the API client, API health fetch, server-side current-user lookup and form error mapping.                                                                |
| CI                | GitHub Actions runs typecheck, lint, format check, the full test suite against a PostgreSQL 18 service container, and the API and web builds on every PR and push to `main`. |

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
│   │   │   │   └── schema/           # Drizzle schema: users.ts, sessions.ts, index.ts
│   │   │   ├── modules/
│   │   │   │   └── auth/
│   │   │   │       ├── routes.ts     # POST register/login/logout, GET me under /api/v1/auth
│   │   │   │       ├── service.ts    # registerUser, verifyCredentials (timing-safe)
│   │   │   │       ├── session.ts    # Session tokens, hashing, cookie options, 7-day expiry
│   │   │   │       ├── password.ts   # Argon2id hash and verify
│   │   │   │       └── require-auth.ts # requireAuth preHandler (401 without a valid session)
│   │   │   ├── plugins/
│   │   │   │   ├── csrf.ts           # Origin check on state-changing requests
│   │   │   │   ├── db.ts             # pg pool + Drizzle instance as app.db
│   │   │   │   └── error-handler.ts  # Consistent error responses; generic 500s
│   │   │   ├── routes/
│   │   │   │   ├── health.ts         # GET /health (liveness)
│   │   │   │   └── ready.ts          # GET /ready (readiness, checks the database)
│   │   │   └── test/
│   │   │       ├── db.ts             # Test database helpers
│   │   │       └── global-setup.ts   # Migrates diffcraft_test before the tests
│   │   ├── drizzle.config.ts
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── vitest.config.ts
│   ├── web/                          # Next.js frontend (App Router)
│   │   ├── src/
│   │   │   ├── app/
│   │   │   │   ├── layout.tsx
│   │   │   │   ├── page.tsx          # Home page: API health plus log in / sign up / profile links
│   │   │   │   ├── globals.css
│   │   │   │   ├── login/            # page.tsx, login-form.tsx
│   │   │   │   ├── register/         # page.tsx, register-form.tsx (sign-up)
│   │   │   │   └── profile/          # page.tsx, logout-button.tsx
│   │   │   ├── components/           # form-field.tsx, page-card.tsx, styles.ts
│   │   │   └── lib/
│   │   │       ├── api-client.ts     # Browser calls to the API via relative /api URLs
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
│       │   ├── health.ts             # HealthResponseSchema
│       │   ├── ready.ts              # Readiness response
│       │   └── zod-issues.ts         # Zod error formatter
│       ├── package.json
│       ├── tsconfig.json
│       └── vitest.config.ts
├── infra/
│   └── postgres/
│       └── init/
│           └── 01-create-test-db.sql # Creates diffcraft_test on first start
├── docs/
│   └── architecture.md               # (planned) Extended architecture notes and decision records
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
└── README.md
```

As the API grows, `apps/api/src` is expected to gain `plugins/`, `modules/`, `db/` (Drizzle schema and migrations) and `realtime/` folders _(planned)_. The worker may first live as a second entrypoint inside `apps/api` to share the database layer, and be split out later.

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

Migrations run on start because the API is a single free instance. With several instances they would race on every deploy, so the target architecture below runs them as a separate release step.

---

## Deployment Architecture

### Current deployment (Implemented)

```mermaid
flowchart LR
    U["Users' browsers"]
    WEB["Vercel<br/>Next.js web app"]
    API["Render free web service<br/>Fastify API (single instance)"]
    PG[("Neon<br/>PostgreSQL 18")]

    U -- "HTTPS: pages and relative /api/... calls" --> WEB
    WEB -- "/api/:path* rewrite (HTTPS)" --> API
    API -- "SQL over TLS" --> PG
```

- The browser only ever talks to the Vercel origin. Next.js rewrites `/api/:path*` to the Render API (`API_URL`), so the session cookie belongs to the web app's origin and no CORS is needed.
- The API is a single free Render instance. It sleeps after inactivity (cold starts of about a minute) and applies pending migrations on start (`start:prod`).
- Neon hosts PostgreSQL 18; the API uses its direct (non-pooled) connection string.
- No Redis and no worker are deployed yet.

### Future architecture (Planned)

> **Planned, not deployed.** This is the target once real-time (Stage 7) and AI analysis (Stage 8) need several API instances, Redis and a worker.

```mermaid
flowchart TB
    U["Users' browsers"]

    subgraph Edge
        LB["HTTPS reverse proxy / load balancer<br/>(sticky sessions or WebSocket-capable)"]
    end

    subgraph App["Application tier (containers)"]
        WEB["Next.js frontend"]
        API1["Fastify API + Socket.IO<br/>instance 1"]
        API2["Fastify API + Socket.IO<br/>instance N"]
        WK["AI worker<br/>instance(s)"]
    end

    subgraph DataTier["Managed data services"]
        PG[("PostgreSQL<br/>with backups")]
        RD[("Redis")]
    end

    LLM["External LLM provider API"]

    U -- HTTPS --> LB
    LB --> WEB
    LB -- "REST + WebSocket" --> API1
    LB -- "REST + WebSocket" --> API2
    API1 --> PG
    API2 --> PG
    API1 <-. "queues + Socket.IO adapter" .-> RD
    API2 <-. "queues + Socket.IO adapter" .-> RD
    WK <-. "consume jobs / publish events" .-> RD
    WK --> PG
    WK -- "HTTPS (egress only)" --> LLM
```

Notes:

- Only the worker needs outbound access to the LLM provider and holds its API key.
- Socket.IO across multiple API instances requires the Redis adapter and either sticky sessions or WebSocket-only transport.
- Migrations run as a separate release step, not on application start (unlike the current single-instance setup).

---

## Development Roadmap

| Stage                             | Scope                                                                                                                                                                                | Status          |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------- |
| **0. Foundation**                 | pnpm monorepo; shared TypeScript, ESLint, Prettier and Vitest config; shared package; API and web skeletons; local Docker Compose; CI.                                               | **Implemented** |
| **1. Database and auth**          | Drizzle schema and migrations; database connection; `/ready` probe; registration, login and sessions; sign-up, login and profile pages; free-tier deployment (Vercel, Render, Neon). | **Implemented** |
| **2. Workspaces and roles**       | Workspaces, membership and invitations; role-based authorization guards.                                                                                                             | Planned         |
| **3. Reviews and diff ingestion** | Review creation from patch upload; diff parsing and storage; changed-file list; revisions.                                                                                           | Planned         |
| **4. Diff viewer**                | Unified and side-by-side diff views; file navigation; stable line references.                                                                                                        | Planned         |
| **5. Comments and threads**       | Line-anchored comments, replies, resolution and outdated detection.                                                                                                                  | Planned         |
| **6. Approvals and lifecycle**    | Reviewer assignment; approve / request changes; status recomputation; review history.                                                                                                | Planned         |
| **7. Real-time**                  | First use of Redis: Socket.IO with session auth and rooms; emit-after-commit; presence (Redis TTL keys); notifications; Socket.IO Redis adapter.                                     | Planned         |
| **8. AI analysis**                | Job model; BullMQ queue (on Redis) and worker; provider adapter; context building and redaction; schema-validated findings; retries; findings UI.                                    | Planned         |
| **9. Hardening and deployment**   | Rate limiting, security headers, end-to-end tests, Dockerfiles, multi-instance deployment, observability.                                                                            | Planned         |

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

---

## Contributing

DiffCraft is at an early stage, and the architecture is still being established. Contributions and design feedback are welcome.

1. **Open an issue first** for anything non-trivial, so the approach can be discussed against the planned architecture.
2. **Fork and branch** from `main` using a descriptive branch name (e.g. `feat/review-approvals`, `fix/comment-pagination`).
3. **Keep changes focused.** One concern per pull request.
4. **Validate at boundaries.** New endpoints and events should come with Zod schemas in `packages/shared`.
5. **Include tests** for new behaviour, including authorization failure cases.
6. **Never commit secrets** or real `.env` files.
7. **Update documentation** — including the [Current Status](#current-status) table — when a feature moves from Planned to In progress or Implemented.
8. Use clear commit messages (Conventional Commits are encouraged).

A `CONTRIBUTING.md` and code of conduct will be added as the project matures.

---

## License

**License status: undecided.** No license file has been added yet. Until a license is chosen and a `LICENSE` file is committed, all rights are reserved by the author by default, and the code may not be reused without permission.
