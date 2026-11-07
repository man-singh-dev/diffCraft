# Security

How authentication works today, the planned authorization model, and the status of each security safeguard.

[← Back to README](../README.md)

---

## Authentication and Authorization

> Status: **Implemented** for authentication (Stage 1), the workspace role guard and member management (Stage 2), and the review author rule (Stage 3). Invitations, reviewer assignment and approval rules are **Planned**.

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
- **Not yet:** login and registration are **not rate-limited** (planned, Stage 9), and registration still reveals whether an email is taken (`409`). See [Known Limitations](../README.md#known-limitations).

### Email verification (Implemented)

Code: `apps/api/src/modules/auth/verification.ts`, `apps/api/src/mail/`.

- **Tokens** are 32 random bytes (256 bits) in base64url, sent only in the email link (`${WEB_ORIGIN}/verify-email?token=…`). `email_verification_tokens` stores only the SHA-256 hash (unique), with `expires_at` 24 hours ahead and `used_at`. A plain hash is enough: there is nothing to brute-force in 256 random bits. The raw token is never stored and never logged: the send-failure log keeps only the error name, code and message (with the token cut out), and the logger redacts any `token` field.
- **Single use, race-free.** Verifying is one `UPDATE … SET used_at = now() WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now() RETURNING user_id`, then `email_verified_at = now()` only if still `NULL`, in one transaction. Two requests with the same token can't both win: the second waits on the row lock, re-checks `used_at IS NULL` and matches nothing (tested 10 times in a row).
- **One generic error.** Unknown, expired, used and malformed tokens all get the same `400 invalid_token` and message, so the endpoint reveals nothing about which tokens exist. Malformed tokens are refused before any query.
- **Resend throttle.** `resend-verification` needs a session and answers `429 verification_throttled` with `Retry-After` if the user's last link is under 60 seconds old. The check and the insert run under a lock on the user row, so concurrent resends can't both pass. Older unused links stay valid until they expire.
- **Send after commit.** Registration creates the user and the token in one transaction and sends the email only after the commit, so an email never refers to a rolled-back account. The trade-off: if the process dies or the provider fails after the commit, no email goes out. Registration still answers `201` (the failure is logged) and the user can resend. A transactional outbox (the email written in the same transaction, sent and retried by a worker) is planned to close that gap.
- **What it gates.** Only being added to a workspace: `POST /members` answers `422 email_not_verified` for an unverified account, so an admin can't add someone by an address that person may not own. Unverified users can still log in and create their own workspaces and reviews. Accounts that existed before verification were marked verified by the migration (`email_verified_at = created_at`).
- **Transports.** `MAIL_TRANSPORT=smtp` (default) sends through `MAIL_SMTP_URL`, which production must set explicitly along with `MAIL_FROM`; locally it is Mailpit. `MAIL_TRANSPORT=log` writes each email, **link included**, to the API log at `info`: it is only for environments without an email provider, because anyone with log access can then verify any address.
- OAuth sign-in (e.g. GitHub) is a future enhancement.

### Authorization model

Authorization is evaluated in two layers:

**1. Workspace role** (stored in `workspace_members.role`). **Implemented** for the workspace endpoints.

Roles are ranked **viewer < member < admin < owner**. `hasAtLeastRole(role, minimum)` in `packages/shared/src/workspaces.ts` compares two roles, so each route states only its _minimum_ role and every higher role passes too. The table shows the intended capabilities; only the workspace and member rows exist so far (view: viewer, rename and manage members: admin, delete: owner).

| Capability                                | Owner | Admin | Member | Viewer |
| ----------------------------------------- | :---: | :---: | :----: | :----: |
| View reviews, comments, findings          |   ✓   |   ✓   |   ✓    |   ✓    |
| Create reviews, comment, request analysis |   ✓   |   ✓   |   ✓    |   —    |
| Manage members and roles                  |   ✓   |   ✓   |   —    |   —    |
| Delete the workspace / transfer ownership |   ✓   |   —   |   —    |   —    |

**2. Review relationship** (author, assigned reviewer). The author and reviewer rules are **Implemented**; revisions are **Planned**.

- Editing, closing, reopening or deleting a review is allowed for its **author** (if they are still a member or above) and for any **admin or owner**. A viewer, or a member acting on someone else's review, gets `403`. The rule is one pure function, `canEditReview` in `packages/shared`, used by the API and (for hiding buttons) the web UI.
- Only **assigned reviewers** can submit approval decisions; an **author** cannot approve their own review. See [Approvals](#approvals-implemented).
- Only the **author** can submit new revisions.
- Comment rules are **Implemented**; see [Comments](#comments-implemented).

### Enforcement

**Implemented** guards are reusable Fastify `preHandler`s, so a route can't skip a check by forgetting to call it inside the handler:

| Guard                           | Where                                                                                                 | Result                                                                        |
| ------------------------------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `requireAuth`                   | `modules/auth/require-auth.ts`; every `/api/v1/workspaces` route and `GET /auth/me`                   | `401 unauthenticated` without a valid session; otherwise sets `request.user`. |
| `requireWorkspaceRole(minimum)` | `modules/workspaces/require-workspace-role.ts`; every `/:workspaceId` route; runs after `requireAuth` | See below; on success sets `request.workspace = { id, role }`.                |

`requireWorkspaceRole` checks, in order:

1. `:workspaceId` is not a UUID → `404 workspace_not_found`. It never reaches the database, so a malformed id can't cause a `500`.
2. The caller has no membership row for that workspace, including when the workspace doesn't exist → `404 workspace_not_found`.
3. The caller's role is below `minimum` → `403 forbidden`.
4. Otherwise the handler runs, using the role the guard loaded.

**Why `404`, not `403`, for non-members:** a `403` would confirm that the workspace exists, so anyone could probe ids. Non-members get a body byte-for-byte identical to the one for a random non-existent id (tested). A `403` is only given to members, who already know the workspace exists.

**IDOR protection:** the guard looks up the membership for the `workspaceId` in the URL _and_ the session's user, so changing the id in the URL never reaches another user's workspace (tested for `GET`, `PATCH` and `DELETE`). The CSRF Origin check runs before all of this, on `POST`, `PATCH` and `DELETE`.

### Member management (Implemented)

Code: `apps/api/src/modules/workspaces/member-service.ts`. The rules live in the service, not the routes, so every caller gets them.

- **Owner-only changes.** Only an owner may add someone as owner, change anyone's role to or from owner, or remove an owner. An admin may add, change and remove only admins, members and viewers, so an admin can't promote anyone (themselves included) to owner, nor demote or remove an owner (`403 forbidden`).
- **Last-owner invariant.** A workspace always keeps at least one owner. Demoting or removing the last owner, or the last owner leaving, is `409 last_owner`. (Removing the last owner can't actually happen through `DELETE`, since only an owner can remove an owner and nobody can remove themselves; the check is there anyway.)
- **Leave vs remove.** `DELETE /members/:userId` with your own id is refused with `400 cannot_remove_self`; leaving is `POST /members/leave`. Keeping them apart means "remove" always acts on someone else, under the admin/owner rules, while "leave" is open to every member and limited only by the last-owner rule.
- **Locking.** Every member change (add, role change, remove, leave) runs in one transaction that first locks the workspace row with `SELECT … FOR UPDATE`, then re-reads the caller's role, then counts owners, then writes. Without the lock, "count owners, then demote one" is a check-then-act race: under `READ COMMITTED`, two owners demoting each other at once would both see two owners, update different rows (no row conflict), and leave the workspace with none. With the lock the second transaction waits, then sees the first one's result. Re-reading the caller's role under the lock matters too: the role `requireWorkspaceRole` loaded may have just been taken away. A test runs that two-owner race 10 times and requires exactly one success and exactly one owner left; with the lock removed it fails.
- **Immediate effect.** Roles are read from the database on every request, so a removed member gets `404` on their next request (tested).
- **Known limitation:** adding by email answers `404 user_not_found` for an unknown email and `422 email_not_verified` for an unverified one, so a workspace admin (and anyone can create a workspace) can check whether an email has an account. Registration already reveals this; email invitations (planned) will replace it.

**Reviews (Implemented):** review routes are nested under `/workspaces/:workspaceId`, so the same guard runs first and non-members get the same `404 workspace_not_found` on every review route. Every review query is scoped by `workspace_id` as well as the review number or id, and review files are reached only through their review (joined to `reviews` for the workspace check), so a review or file of workspace B is `404` through workspace A even for a user who belongs to both (tested). A malformed `:reviewNumber` (not a positive int4) is `404 review_not_found` before any query.

**Patch input (Implemented):** a patch is parsed as text only, before anything is stored, with limits on size (1 MiB of UTF-8), files, lines and line length. Text containing NUL is refused (`invalid_patch`, reason `unsupported_encoding`); Postgres `text` can't store it. `POST /reviews` has its own 3 MiB body limit (JSON escaping inflates a patch); every other route keeps the 1 MiB default.

**Planned:**

- Every future protected route (findings) resolves the target resource **with its workspace** and checks membership before any other logic, never trusting a `workspaceId` supplied by the client alone.
- Socket.IO connections authenticate at handshake using the same session; joining a review room re-checks membership. Membership changes cause the server to remove sockets from rooms.

### Comments (Implemented)

Code: `apps/api/src/modules/comments/routes.ts`. The rules are pure functions in `packages/shared/src/comments.ts`, so the web UI can offer only what the API allows.

| Action                     | Rule                                                                                                                                                                      |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Read threads               | Any member (viewer and up).                                                                                                                                               |
| Start a thread, reply      | `canComment`: member and up.                                                                                                                                              |
| Edit a comment             | `canEditComment`: only its author, and not once deleted. Admins and owners **can't** edit other people's comments, so nobody can put words in someone else's name.        |
| Delete a comment           | `canDeleteComment`: its author (if still a member or above) or any admin or owner, unless already deleted. Deleting is a soft delete: the row stays, the body is emptied. |
| Resolve or reopen a thread | `canResolveThread`: a member or above who started the thread or wrote the review, or any admin or owner.                                                                  |

- **Nesting is checked, not assumed:** a thread must belong to the review in the URL, and a comment to the thread in the URL (not just the same review), else `404`. Every query matches through the review _and_ its workspace, so ids from another review or workspace find nothing, even for a user who belongs to both (tested).
- **Order of checks:** review → thread → comment → permission → body. A caller learns nothing about threads or comments they can't reach, and a forbidden request is `403` whatever its body.
- **A demoted author** (now a viewer) can still edit their own comment, but can no longer delete it or comment again.
- **Closed reviews** still accept comments: closing a review ends the review, not the discussion.

### Approvals (Implemented)

Code: `apps/api/src/modules/approvals/routes.ts` and `service.ts`. The rules are pure functions in `packages/shared/src/approvals.ts` (`canAssignReviewers`, `canDecide`, `canMerge`, `evaluateReview`), so the web UI can offer only what the API allows.

| Action                                              | Rule                                                                                                                                     |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Read state, reviewers, decisions, history and rules | Any member (viewer and up).                                                                                                              |
| Assign reviewers                                    | `canAssignReviewers`: the review's author (member and up) or any admin or owner. Reviewers must be members or above, and not the author. |
| Unassign a reviewer                                 | The same, or the reviewer themselves (stepping down).                                                                                    |
| Approve or request changes                          | `canDecide`: a member or above who is assigned to the review and isn't its author, on an open review.                                    |
| Merge                                               | `canMerge`: the author (member and up) or any admin or owner, and only when `evaluateReview` passes the workspace's rules.               |
| Change the rules                                    | Admins and owners.                                                                                                                       |

- **Separation of duties:** the author never counts towards their own approvals: they can't be assigned (`422 invalid_reviewers`, reason `author`) and can't decide (`403`), even as an admin or owner. With `requiredApprovals ≥ 1`, someone other than the author must approve before the author (or an admin) can merge. An admin can merge someone else's review, but only when the rules pass; there is no override in the API. `requiredApprovals: 0` turns this off for the workspace, and only an admin can choose that.
- **Stale approvals don't count:** only decisions of **current** reviewers made since their current assignment count. Removing a reviewer (or the reviewer stepping down) drops their approval or request for changes, and re-assigning them requires a new decision, so an approval can't be carried over by removing and re-adding someone. Assignments and decisions are dated with `clock_timestamp()` after the review lock, not `now()`, so a transaction that waited for the lock is still dated after what it waited for.
- **Races:** assigning, unassigning, deciding and merging lock the review row (`SELECT … FOR UPDATE`) and re-check its state under the lock. The merge computes the state after taking the lock, so a racing request for changes either commits first and blocks the merge or runs after it and gets `409 review_not_open` (tested 25 times in a row).
- **Merged is final:** a merged review can't be edited, closed, reopened or deleted, its reviewers can't change and it takes no decisions (`409`).
- **Nesting and IDOR:** every query is scoped by the review _and_ its workspace, so the state, reviewers, decisions and events of a review in workspace B are `404` through workspace A, even for a user in both (tested). Unassigning someone who isn't a reviewer of _this_ review is `404 reviewer_not_found`, checked before the permission.
- **History is kept:** decisions and events are append-only and survive account deletion, with the user set to `null`.

---

## Security Considerations

> Rows marked **Implemented** exist in the code and have tests. The rest are **design goals**. No security audit has been done, and no security guarantees are claimed.

| Area                         | Safeguard                                                                                                                                                                                                                                                                        | Status             |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| Authentication               | Argon2id password hashing; hashed session tokens; HttpOnly/SameSite=Lax cookies (Secure in production); session revocation on logout; CSRF Origin check; timing-safe login. See [Authentication](#authentication-implemented).                                                   | **Implemented**    |
| Resource-level authorization | Membership and role checks on every route and socket room, with resources loaded through their workspace. `requireWorkspaceRole` guards every `/api/v1/workspaces/:workspaceId` route, with `404` for non-members, review routes included (**Implemented**). Sockets come later. | Partly implemented |
| Input validation             | Zod schemas for auth request bodies and environment variables (**Implemented**; unknown fields are currently stripped, not rejected). Params, query strings and socket payloads are added with their routes.                                                                     | Partly implemented |
| SQL injection                | All queries through Drizzle's parameterized query builder; no string-concatenated SQL.                                                                                                                                                                                           | **Implemented**    |
| Rate limiting                | Per-IP and per-user limits (e.g. `@fastify/rate-limit` backed by Redis), stricter on auth and analysis endpoints. **Nothing is rate-limited yet.**                                                                                                                               | Planned            |
| Submitted code               | Treated strictly as text: never executed, compiled or evaluated. Size, file, line and encoding limits on patches (**Implemented**). Rendered with escaping (no `dangerouslySetInnerHTML` for code or comments).                                                                  | Partly implemented |
| Prompt injection             | Code is passed to the model as delimited, untrusted data; model output cannot trigger actions and is validated against a schema before storage.                                                                                                                                  | Planned            |
| Secret disclosure            | `.env` files git-ignored, secrets loaded from environment only, and config errors list variable names, never values (**Implemented**). Redaction before LLM calls and logs that exclude code and prompts come later.                                                             | Partly implemented |
| LLM API keys                 | Stored only server-side (worker environment); never sent to the browser or exposed via `NEXT_PUBLIC_*` variables.                                                                                                                                                                | Planned            |
| AI request safety            | Timeouts, bounded retries, cost and size limits per request and workspace.                                                                                                                                                                                                       | Planned            |
| Duplicate jobs               | Database-level unique idempotency key plus queue-level job IDs.                                                                                                                                                                                                                  | Planned            |
| Concurrent updates           | Member changes lock the workspace row (`SELECT … FOR UPDATE`) so the last-owner check can't race (**Implemented**). Optimistic locking on reviews, row locks for status recomputation and idempotent resolution come later.                                                      | Partly implemented |
| Transport and headers        | HTTPS in deployment (Vercel and Render) and no CORS needed, since the browser only talks to the web app's origin (**Implemented**). Security headers (e.g. `@fastify/helmet`) come later.                                                                                        | Partly implemented |
| Information leakage          | Generic `500` messages to clients with details only in server logs, and one error for unknown email or wrong password (**Implemented**). `404` for inaccessible resources comes with authorization.                                                                              | Partly implemented |
