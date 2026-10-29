# API

The REST API design: conventions, every implemented and proposed endpoint, and who may call it.

[← Back to README](../README.md)

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
