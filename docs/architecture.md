# Architecture

What DiffCraft is for, its design principles and features, how the pieces fit together, how data flows, the review lifecycle and the deployment architecture (current and future).

[← Back to README](../README.md)

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

1. An author creates a review in a workspace and submits a diff (initially as a unified diff / patch upload; GitHub pull request import is planned for Stage 10).
2. The author assigns reviewers. Assigned reviewers are notified in real time.
3. Reviewers navigate the diff and leave line-anchored comments; others reply in threads.
4. Any participant with permission may request an AI analysis. The request is processed in the background, and findings appear on the relevant lines once ready.
5. Reviewers resolve threads, dismiss or discuss findings, and record a decision: **approve** or **request changes**.
6. If changes are requested, the author submits a new revision. Comments on changed lines are marked outdated, and the review returns to _in review_.

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

## Diff Parsing

**Implemented** (no routes use it yet). `parsePatch(text, limits?)` in `packages/shared/src/diff/` turns a unified diff into files → hunks → lines, with the old and new line number of every line. It is pure code with no I/O, so the API can validate uploads with it and the web app can render the same structure. The result types are Zod schemas (`ParsedPatchSchema`), so stored or transferred diffs can be validated too.

**Supported input:** `git diff` and `git format-patch` output (new, deleted, renamed and copied files, mode-only changes, binary files, quoted paths such as `"a/caf\303\251 menu.txt"`) and plain `diff -u` output. LF and CRLF line endings, `\ No newline at end of file`, omitted hunk counts (`@@ -3 +3 @@` means one line) and text between files (commit messages, diffstats) are handled. Binary contents are not decoded; the file is just marked `isBinary`.

**Limits** (each can be overridden per call):

| Limit               | Default |
| ------------------- | ------- |
| Patch size          | 1 MB    |
| Files               | 300     |
| Diff lines in total | 20,000  |
| Characters per line | 5,000   |

The size limit is checked before any parsing, so an oversized upload costs almost nothing. Anything the parser can't trust throws a `DiffParseError` with a short `code` (`empty_patch`, `too_large`, `count_mismatch`, …) and the 1-based `line` it failed on, ready to show to the user.

**Why the hunk counts are trusted:** a hunk's lines are read by the counts in its `@@ -a,b +c,d @@` header, not by guessing from line prefixes. A removed SQL comment (`-- note`) appears in the patch as `--- note`, and an added `++i;` as `+++i;`, which look exactly like file headers. Counting is how `git apply` and `patch` read hunks, so the parser agrees with them; if the lines don't match the counts, the patch is rejected (`count_mismatch`) instead of being guessed at. The regular expressions are anchored with bounded repeats, so parsing time stays linear on hostile input.

### Diff view model

**Implemented.** Pure functions in `packages/shared/src/diff/view/` turn a file's hunks into rows for the web app: `buildUnifiedRows` (one column) and `buildSplitRows` (side by side). Both contain hunk header rows, line rows and gap rows for lines that aren't in the patch (before the first hunk and between hunks; none after the last, since the file length is unknown). Every row has a key that is stable and unique within the file.

**Pairing:** within a hunk, a run of deleted lines directly followed by a run of added lines is a change block; the i-th deletion is paired with the i-th addition, and leftovers stay unpaired. Context lines end a block. In the split view a pair shares one row, and a leftover has an empty cell on the other side.

**Word-level highlighting:** `diffWords` splits paired lines into words, whitespace runs and single other characters, and marks the tokens outside their longest common subsequence as changed. To avoid slow tables and scattered "confetti" highlighting, the whole line is marked changed instead when either line has more than 200 tokens or 1,000 characters, or when under 40% of the characters are in common tokens. Joining the segments always gives back the original text.

**Line anchors:** `lineAnchor(fileId, side, number)` gives `f-<fileId>-L12` (old side) or `f-<fileId>-R12` (new side); deleted lines use the old side and context and added lines the new side. `parseLineAnchor` accepts only a UUID, `L`/`R` and a positive int4, and returns `null` for anything else.

### Syntax highlighting

**Implemented.** Diffs are highlighted on the server with [Shiki](https://shiki.style) in `apps/web/src/lib/highlight.server.ts`, so the browser downloads no grammars. It uses Shiki's JavaScript regex engine (no WASM), so it runs the same locally and on Vercel. One highlighter is created per server process, and grammars load on first use, only from an allow-list of common languages picked by file extension.

**Per side, per hunk:** each hunk's old text (context and deleted lines) and new text (context and added lines) are highlighted as two separate code blocks, so a multi-line comment or string is read the way it is on that side. Tokens are then mapped back to old and new line numbers; context lines take theirs from the new side. `mergePieces` (shared) overlays the tokens on the word-diff segments, so each piece has both a color and a changed flag.

**Limits:** files in unknown languages or with more than 5,000 diff lines aren't highlighted, and a line over 1,000 characters is shown plain. If Shiki throws, the error is logged and the diff is shown plain. Highlighting never blocks a diff from rendering.

**No HTML strings:** only Shiki's token API is used (no `codeToHtml`), and the viewer renders pieces as React elements, so there is no `dangerouslySetInnerHTML`.

### Diff viewer

**Implemented.** The "Files changed" page (`/workspaces/[workspaceId]/reviews/[reviewNumber]/files`) shows every file of a review, with a file sidebar and a Unified / Split toggle kept in the URL (`?view=split`).

- **Eager and lazy files:** the first 5 files with at most 400 changed lines are rendered on the server, each in its own `<Suspense>` boundary so they stream in. Larger files, and any after the first 5, show a "Load diff" button. It calls the `loadFileDiff` Server Action, which validates every argument (it is a public endpoint), fetches the diff from the API with the user's session cookie, and returns highlighted rows or a typed error. A failed diff shows an inline error with Retry; the rest of the page keeps working.
- **One table component:** `DiffTable` has no hooks and no `'use client'`, so server components (eager files) and the client "Load diff" button render the same markup.
- **Line links:** every line number links to its anchor (`#f-<fileId>-L12` / `-R12`), the row carries that id, and CSS `:target` highlights it. A small client component handles deep links into files that aren't loaded yet: it parses the hash, asks that file to expand and load, waits for the line to appear, then scrolls to it.

---

## Reviews

**Implemented as a data layer** (`apps/api/src/modules/reviews/service.ts`); the HTTP routes and pages come in the next steps. A review is a patch uploaded to a workspace, stored with its parsed files.

| Table          | Holds                                                                                                                                                                                                              |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `reviews`      | One row per review: workspace, per-workspace `number`, author (`NULL` once the account is deleted), title, description, status (`open`, `closed` or `merged`), the raw `patch`, and file/addition/deletion totals. |
| `review_files` | One row per file in the patch, in patch order (`position`, 0-based): paths, change type, binary flag, counts, and the parsed hunks as `jsonb`.                                                                     |

**Creating a review:** the patch is parsed with `parsePatch` _before_ a transaction is opened, so a bad patch (a `DiffParseError`) costs no database work and writes nothing. Then one transaction takes the next number, inserts the review and inserts all its files in a single multi-row `INSERT`. If any step fails, nothing is kept and the number is not used up.

**Why a counter for `number`:** reviews are numbered 1, 2, 3 … per workspace, like issues. `workspaces.last_review_number` is incremented with `UPDATE … SET last_review_number = last_review_number + 1 … RETURNING`. That `UPDATE` locks the workspace row until the transaction ends, so two concurrent creates get different numbers. `SELECT max(number) + 1` would let both read the same maximum. `UNIQUE (workspace_id, number)` backs this up.

**Why `jsonb` for hunks:** a file's hunks are always read whole, one file at a time, and never searched or joined. Tables for hunks and lines would mean up to 20,000 rows per review for no benefit. The raw `patch` is kept as well, so files can be re-parsed if the parser or the stored shape changes.

**Isolation between workspaces:** `getReview` matches the review id _and_ the workspace id, and `getReviewFileHunks` matches the file id _and_ the review id, so ids from another workspace find nothing.

---

## Comments and threads

**Implemented in the API** (`apps/api/src/modules/comments/`: service and routes, see [api.md](api.md#comment-threads)); the UI comes next. A thread is about the review as a whole, or anchored to one line on one side (`old` or `new`) of one file. It holds comments, oldest first, and is `open` or `resolved`. Tables: [database.md](database.md#table-responsibilities).

- **Anchors are checked against the diff:** the file must belong to the review and not be binary, and the line must exist on that side of its hunks (deleted and context lines are on the old side, added and context lines on the new). The line's text is stored with the thread, so it can still be shown if the line changes in a later revision.
- **One transaction** inserts a thread and its first comment, so a thread never exists without one.
- **Scoped by workspace:** every query matches the thread or comment through its review _and_ the review's workspace, so an id from another workspace finds nothing.
- **Two queries per review:** `listThreads` loads the threads, then all their comments with `WHERE thread_id IN (…)`, and groups them in memory, however many threads there are.
- **Soft delete:** a deleted comment keeps its row and place in the thread, with an empty body.
- **Idempotent resolution:** setting a thread's status only changes it if it differs, so resolving twice keeps the first resolver and time; reopening clears both.
- **Permissions** are shared pure functions (`canComment`, `canEditComment`, `canDeleteComment`, `canResolveThread`), so the UI will offer only what the API allows. Admins can delete anyone's comment but edit only their own.

### Suggested changes

**Implemented** (`packages/shared/src/suggestions.ts`, the `suggestion.patch` route in [api.md](api.md#suggested-changes), and the comment UI). A reviewer proposes replacement text for the line a thread is on; the review's author can copy it or download it as a patch.

- **Format:** a line that is exactly ` ```suggestion `, the replacement lines, then a line that is exactly ` ``` ` (trailing spaces allowed on both fences, CRLF tolerated). An empty block means "delete this line". An unclosed fence is plain text. `parseCommentBody` splits a body into text and suggestion parts in linear time (no regular expressions, and the next closing fence is precomputed, so a body full of unclosed fences costs no rescans). The body schema allows at most one block per comment.
- **New side only:** a suggestion replaces a line of the _new_ version of a file, which is what the author has on their branch. On old-side line threads and review-level threads the block is shown as text with a note, and the patch route answers `422 suggestion_not_applicable`.
- **The patch** (`buildSuggestionPatch`) is built from the stored hunks, relative to the new version: `--- a/<path>` / `+++ b/<path>` (C-quoted when the path needs it), one hunk with up to 3 lines of context before and after, taken only from new-side lines (context and added) of the same hunk that are contiguous by line number, because nothing outside the hunks is known. A line at the end of a file without a final newline keeps its `\ No newline at end of file` marker, and so does its replacement. A count of 0 (deleting a file's only line) uses the line before as the start, as git does.
- **Verified with git:** the tests parse every generated patch with `parsePatch` and apply it to the expected file, and an integration test writes real files in a temporary directory, takes the hunks from `git diff --no-index`, and runs `git apply --check` and `git apply` on the suggestion patch (skipped when git isn't installed).
- **UI:** a suggestion renders as a small diff box (the thread's stored `lineContent` as the `-` line, each suggested line as a `+` line, all as escaped text), with Copy and Download patch. On new-side line threads, the composer for a new thread or a reply has a "Suggest change" button that inserts a block pre-filled with the line's current text.

---

## Approvals

**Implemented as a data layer** (`packages/shared/src/approvals.ts` for the rules, `apps/api/src/modules/approvals/service.ts` for the database); routes and UI come next. Tables: [database.md](database.md#table-responsibilities).

- **Reviewers** are assigned per review (`review_reviewers`). They must be workspace members with role `member` or higher and not the review's author; otherwise the whole request fails with `422 invalid_reviewers`, listing each refused user and why. Assigning someone twice is a no-op (`ON CONFLICT DO NOTHING`) and writes no second event.
- **Decisions are append-only** (`review_decisions`): approving after requesting changes adds a row rather than updating one, so the full history stays. Only each _current_ reviewer's latest decision counts, read in one query with `DISTINCT ON (reviewer)` starting from `review_reviewers`; a removed reviewer's decisions stay in history but stop counting.
- **The approval state is derived, never stored.** `evaluateReview` (pure, shared with the web) takes the review status, the latest decision per reviewer, the open-thread count and the workspace's rules (`required_approvals` 0–10, `require_resolved_threads`) and returns `pending` / `approved` / `changes_requested`, the counts, `canMerge` and plain-language `reasons` for every failing rule ("1 of 2 required approvals", "Ravi requested changes", "2 unresolved threads", "The review is closed"). Any latest `request_changes` blocks. With 0 required approvals a review can merge without approvals, but it shows as `approved` only once someone approves. Storing the state would mean keeping it in step with every decision, removal, thread change and rule change.
- **Event log** (`review_events`): reviewer assigned/removed, decision, closed, reopened and merged, each with its actor, written in the _same_ transaction as the change, so the history can't miss or invent one.
- **Status transitions** live in one place, `canTransition`: `open → closed`, `closed → open`, `open → merged`. `merged` is final: a merged review can't be edited, closed, reopened or deleted, and its reviewers can't change (`409 review_merged`). `merged` can't be set through the update request; only the merge does it.
- **Merge under a row lock:** `mergeReview` locks the review row with `SELECT … FOR UPDATE`, _then_ re-reads the rules, decisions and threads inside the transaction, evaluates them, and only then sets `merged`, `merged_by`, `merged_at` and writes the event, or refuses with `409 merge_blocked` and the reasons. A state computed before the transaction is never trusted. Decisions take the same lock, so a request for changes racing with a merge either lands first (and blocks the merge) or finds the review merged (`409 review_not_open`); a test runs that race repeatedly.
- **Permissions** are shared pure functions: `canAssignReviewers` and `canMerge` (the author with `member`+, or an admin/owner; `canMerge` doesn't check the rules), and `canDecide` (`member`+, assigned, not the author, review open).

---

## Review Lifecycle

Review status and comment resolution are **independent**. Resolving every thread does not approve a review, and approving a review does not resolve threads; the workspace's `require_resolved_threads` rule can make open threads block the _merge_.

### Review status (implemented)

```mermaid
stateDiagram-v2
    [*] --> open: Review created
    open --> closed: Author or admin closes
    closed --> open: Reopened
    open --> merged: Merged when the rules pass
    merged --> [*]
```

The approval state (`pending`, `approved`, `changes_requested`) is not a status: it is derived from the decisions each time (see [Approvals](#approvals)).

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

Planned with revisions: a new revision will reset decisions (they remain in history).

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
- Transactional email (Stage 11) is sent by a background job on the same queue, not inline in API requests.
- The GitHub App (Stage 10) calls a webhook endpoint on the API, which verifies the HMAC signature and processes each delivery idempotently.
