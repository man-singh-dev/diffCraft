# API

The REST API design: conventions, every implemented and proposed endpoint, and who may call it.

[← Back to README](../README.md)

---

## API Design

> [!NOTE]
> **All endpoints below are proposed** unless marked **Implemented** (so far the four authentication endpoints, the five workspace endpoints, the five member endpoints, `GET /health` and `GET /ready`). Paths, payloads and semantics may change. Once implemented, the OpenAPI document generated from route schemas will be authoritative.

Conventions (the base path, error shape, `401`, `403`, `404` and `422` are **Implemented**; the rest are proposed):

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

| Method   | Path                                              | Purpose                                                                                          | Auth                             | Status          |
| -------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------ | -------------------------------- | --------------- |
| `GET`    | `/api/v1/workspaces`                              | List the caller's workspaces with their role in each, newest first. `200 Workspace[]`.           | User                             | **Implemented** |
| `POST`   | `/api/v1/workspaces`                              | Create a workspace; the creator becomes owner. Body `{ name }` (trimmed, 1–80). `201 Workspace`. | User                             | **Implemented** |
| `GET`    | `/api/v1/workspaces/:workspaceId`                 | Get one workspace, with the caller's role. `200 Workspace`.                                      | Member (viewer and up)           | **Implemented** |
| `PATCH`  | `/api/v1/workspaces/:workspaceId`                 | Rename. Body `{ name }` (trimmed, 1–80). The slug does not change. `200 Workspace`.              | Admin                            | **Implemented** |
| `DELETE` | `/api/v1/workspaces/:workspaceId`                 | Delete the workspace and all its memberships. `204`.                                             | Owner                            | **Implemented** |
| `GET`    | `/api/v1/workspaces/:workspaceId/members`         | List members, owners first, then by join date. `200 WorkspaceMember[]`.                          | Member (viewer and up)           | **Implemented** |
| `POST`   | `/api/v1/workspaces/:workspaceId/members`         | Add an existing user by email. Body `{ email, role }`. `201 WorkspaceMember`.                    | Admin (adding an owner: Owner)   | **Implemented** |
| `PATCH`  | `/api/v1/workspaces/:workspaceId/members/:userId` | Change a member's role. Body `{ role }`. `200 WorkspaceMember`.                                  | Admin (to or from owner: Owner)  | **Implemented** |
| `DELETE` | `/api/v1/workspaces/:workspaceId/members/:userId` | Remove another member. `204`. Not for yourself: use `/leave`.                                    | Admin (removing an owner: Owner) | **Implemented** |
| `POST`   | `/api/v1/workspaces/:workspaceId/members/leave`   | The caller leaves the workspace. `204`.                                                          | Member (viewer and up)           | **Implemented** |
| `POST`   | `/api/v1/workspaces/:workspaceId/invitations`     | Invite someone who has no account yet.                                                           | Admin                            | Planned         |

`Workspace` is `{ id, name, slug, createdAt, role }` (`WorkspaceSchema` in `packages/shared`), where `role` is the caller's role. `WorkspaceMember` is `{ userId, email, displayName, role, joinedAt }` (`WorkspaceMemberSchema`). Errors on the `/:workspaceId` routes:

| Status | Code                  | When                                                                                          |
| ------ | --------------------- | --------------------------------------------------------------------------------------------- |
| `401`  | `unauthenticated`     | No valid session.                                                                             |
| `404`  | `workspace_not_found` | The id is not a UUID, the workspace doesn't exist, or the caller is not a member (same body). |
| `403`  | `forbidden`           | The caller is a member, but their role is below the route's minimum.                          |
| `403`  | `forbidden_origin`    | `POST`, `PATCH` or `DELETE` from an `Origin` other than `WEB_ORIGIN`.                         |
| `422`  | `validation_error`    | Invalid body on `POST` or `PATCH`.                                                            |
| `404`  | `member_not_found`    | `:userId` is not a UUID or not a member of this workspace.                                    |
| `404`  | `user_not_found`      | Adding a member: no account has this email.                                                   |
| `403`  | `forbidden`           | Members: a non-owner adds an owner, changes a role to or from owner, or removes an owner.     |
| `409`  | `already_member`      | Adding a member who is already in the workspace.                                              |
| `409`  | `last_owner`          | Demoting or removing the last owner, or the last owner leaving.                               |
| `400`  | `cannot_remove_self`  | `DELETE /members/:userId` with your own id; use `POST /members/leave`.                        |

See [security.md](security.md#enforcement) for how the guard works.

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
