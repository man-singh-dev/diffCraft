# API

The REST API design: conventions, every implemented and proposed endpoint, and who may call it.

[← Back to README](../README.md)

---

## API Design

> [!NOTE]
> **All endpoints below are proposed** unless marked **Implemented** (so far the four authentication endpoints, the five workspace endpoints, the five member endpoints, the seven review endpoints, `GET /health` and `GET /ready`). Paths, payloads and semantics may change. Once implemented, the OpenAPI document generated from route schemas will be authoritative.

Conventions (the base path, error shape, `400`, `401`, `403`, `404`, `413`, `422` and cursor pagination are **Implemented**; the rest are proposed):

- Base path `/api/v1`; JSON request and response bodies.
- Errors use a consistent shape: `{ "error": { "code": "...", "message": "...", "details": {...} } }` (`ErrorResponseSchema` in `packages/shared`; unexpected errors become a generic `500 internal_error`).
- `401` when unauthenticated; `403` when authenticated but not permitted; `404` when the resource does not exist **or** the caller cannot see it (to avoid leaking existence across workspaces).
- `409` for optimistic-lock conflicts and invalid state transitions; `422` for validation failures; `429` for rate limits.
- List endpoints accept `?cursor=` and `?limit=` and answer `{ items, nextCursor }` (see [Pagination](#pagination)).
- Request bodies are limited to 1 MiB (`413 payload_too_large`), except `POST /reviews` (3 MiB, see [Reviews](#reviews)).

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

Reviews are addressed by their per-workspace **number** (`#12`), not their UUID. Every review route is nested under the workspace, so the workspace guard (and its `404` for non-members) runs first. `R` below stands for `/api/v1/workspaces/:workspaceId/reviews`.

| Method   | Path                                 | Purpose                                                                                      | Auth                            | Status          |
| -------- | ------------------------------------ | -------------------------------------------------------------------------------------------- | ------------------------------- | --------------- |
| `POST`   | `R`                                  | Create a review from a unified diff. Body `{ title, description?, patch }`. `201 Review`.    | Member (not viewer)             | **Implemented** |
| `GET`    | `R`                                  | List reviews, newest first, filtered and paginated (query below). `200 ReviewListResponse`.  | Member (viewer and up)          | **Implemented** |
| `GET`    | `R/:reviewNumber`                    | Get one review. `200 Review`.                                                                | Member (viewer and up)          | **Implemented** |
| `PATCH`  | `R/:reviewNumber`                    | Edit, close or reopen. Body `{ title?, description?, status? }`, at least one. `200 Review`. | Author (member and up) or Admin | **Implemented** |
| `DELETE` | `R/:reviewNumber`                    | Delete the review and its files. `204`. The number is not reused.                            | Author (member and up) or Admin | **Implemented** |
| `GET`    | `R/:reviewNumber/files`              | The review's files in patch order, without hunks. `200 ReviewFile[]`.                        | Member (viewer and up)          | **Implemented** |
| `GET`    | `R/:reviewNumber/files/:fileId/diff` | One file with its parsed hunks. `200 { file: ReviewFile, hunks }`.                           | Member (viewer and up)          | **Implemented** |
| `POST`   | `R/:reviewNumber/revisions`          | Submit a new revision (new diff).                                                            | Author                          | Planned         |
| `GET`    | `R/:reviewNumber/history`            | Status changes, decisions, revisions and analyses over time.                                 | Member                          | Planned         |
| `PUT`    | `R/:reviewNumber/reviewers`          | Set assigned reviewers.                                                                      | Author or Admin                 | Planned         |

`Review` is `{ id, workspaceId, number, title, description, status, author, filesChanged, additions, deletions, createdAt }` (`ReviewSchema` in `packages/shared`); `author` is `{ id, displayName }`, or `null` once the account is deleted. `ReviewFile` is `{ id, position, oldPath, newPath, changeType, isBinary, additions, deletions }`.

**Who may edit:** `PATCH` and `DELETE` are allowed for the review's author if they are a member or above, and for any admin or owner. A viewer, or a member acting on someone else's review, gets `403 forbidden`. The rule is `canEditReview` in `packages/shared`, so the web UI can hide the same buttons.

**Create:** `title` is trimmed, 1–200 characters; `description` up to 10,000 (blank or `null` means none); neither may contain NUL. The patch is checked by the shared `parsePatch`: at most 1 MiB of UTF-8, 300 files, 20,000 lines and 5,000 characters per line. One leading byte order mark (U+FEFF) is ignored. This route accepts JSON bodies up to **3 MiB** (every other route: 1 MiB) because JSON escaping can nearly double a patch's size; the 1 MiB patch limit still applies to the decoded text.

**List query** (`ListReviewsQuerySchema`):

| Parameter | Values                                | Default |
| --------- | ------------------------------------- | ------- |
| `status`  | `open` or `closed`                    | all     |
| `author`  | `me` or a user UUID                   | all     |
| `limit`   | integer 1–50                          | 20      |
| `cursor`  | the `nextCursor` of the previous page | none    |

#### Pagination

Lists are ordered by `created_at DESC, id DESC` and paginated by keyset, not offset: the next page is the rows strictly after the `(created_at, id)` of the last item, served by the `(workspace_id, created_at DESC, id DESC)` index. Rows created while paging don't shift pages, and nothing is repeated or skipped. `nextCursor` is `null` on the last page.

The cursor is opaque to clients. It is the base64url encoding of `{"createdAt":"2026-01-01T00:00:00.000900Z","id":"<uuid>"}`, where `createdAt` is the database value in UTC with all **six** fractional digits. It never goes through a JS `Date` (milliseconds only), which would skip or repeat rows created within the same millisecond. A cursor the API didn't produce is `400 invalid_cursor`; start again without one. Cursors don't carry the filters, so send the same `status` and `author` with every page.

Errors on the review routes (in addition to the workspace errors above):

| Status | Code                    | When                                                                                                                               |
| ------ | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `404`  | `review_not_found`      | `:reviewNumber` is not a positive integer up to 2147483647 (checked before any query), or no such review exists in this workspace. |
| `404`  | `review_file_not_found` | `:fileId` is not a UUID, or not a file of this review.                                                                             |
| `403`  | `forbidden`             | `POST` by a viewer; `PATCH`/`DELETE` by a viewer, or by a member on someone else's review.                                         |
| `400`  | `invalid_patch`         | The parser rejected the patch. `details: { reason, line }`: `reason` is the parser's code (below), `line` is 1-based or `null`.    |
| `400`  | `invalid_cursor`        | `cursor` can't be decoded.                                                                                                         |
| `413`  | `payload_too_large`     | The JSON body is over 3 MiB (`POST` reviews) or 1 MiB (every other route).                                                         |
| `422`  | `validation_error`      | Invalid body, or invalid list query (`limit`, `status`, `author`).                                                                 |

`invalid_patch` reasons: `empty_patch`, `too_large`, `too_many_files`, `too_many_lines`, `line_too_long`, `not_a_patch`, `malformed_header`, `malformed_hunk`, `count_mismatch`, and `unsupported_encoding` (the text contains NUL characters, usually a UTF-16 or binary file: save it as UTF-8. Postgres `text` can't store NUL, so such input never reaches the database).

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
