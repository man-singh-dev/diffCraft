# Security

How authentication works today, the planned authorization model, and the status of each security safeguard.

[← Back to README](../README.md)

---

## Authentication and Authorization

> Status: **Implemented** for authentication (Stage 1), the workspace role guard and member management (Stage 2). Invitations and review-level rules are **Planned**.

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
- **Not yet:** login and registration are **not rate-limited** (planned, Stage 9), and registration reveals whether an email is taken (`409`) until email verification is added. See [Known Limitations](../README.md#known-limitations).
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

**2. Review relationship** (author, assigned reviewer). **Planned** (Stages 3–6).

- Only **assigned reviewers** can submit approval decisions; an **author** cannot approve their own review.
- Only the **author** can submit new revisions.
- Comment edits are limited to the comment's author.

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
- **Known limitation:** adding by email answers `404 user_not_found` for an unknown email, so a workspace admin (and anyone can create a workspace) can check whether an email has an account. Registration already reveals this; email invitations (planned) will replace it.

**Planned:**

- Every future protected route (reviews, comments, findings) resolves the target resource **with its workspace** and checks membership before any other logic, never trusting a `workspaceId` supplied by the client alone.
- Socket.IO connections authenticate at handshake using the same session; joining a review room re-checks membership. Membership changes cause the server to remove sockets from rooms.

---

## Security Considerations

> Rows marked **Implemented** exist in the code and have tests. The rest are **design goals**. No security audit has been done, and no security guarantees are claimed.

| Area                         | Safeguard                                                                                                                                                                                                                                                            | Status             |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| Authentication               | Argon2id password hashing; hashed session tokens; HttpOnly/SameSite=Lax cookies (Secure in production); session revocation on logout; CSRF Origin check; timing-safe login. See [Authentication](#authentication-implemented).                                       | **Implemented**    |
| Resource-level authorization | Membership and role checks on every route and socket room, with resources loaded through their workspace. `requireWorkspaceRole` guards every `/api/v1/workspaces/:workspaceId` route, with `404` for non-members (**Implemented**). Reviews and sockets come later. | Partly implemented |
| Input validation             | Zod schemas for auth request bodies and environment variables (**Implemented**; unknown fields are currently stripped, not rejected). Params, query strings and socket payloads are added with their routes.                                                         | Partly implemented |
| SQL injection                | All queries through Drizzle's parameterized query builder; no string-concatenated SQL.                                                                                                                                                                               | **Implemented**    |
| Rate limiting                | Per-IP and per-user limits (e.g. `@fastify/rate-limit` backed by Redis), stricter on auth and analysis endpoints. **Nothing is rate-limited yet.**                                                                                                                   | Planned            |
| Submitted code               | Treated strictly as text: never executed, compiled or evaluated. Size limits on patches and files. Rendered with escaping (no `dangerouslySetInnerHTML` for code or comments).                                                                                       | Planned            |
| Prompt injection             | Code is passed to the model as delimited, untrusted data; model output cannot trigger actions and is validated against a schema before storage.                                                                                                                      | Planned            |
| Secret disclosure            | `.env` files git-ignored, secrets loaded from environment only, and config errors list variable names, never values (**Implemented**). Redaction before LLM calls and logs that exclude code and prompts come later.                                                 | Partly implemented |
| LLM API keys                 | Stored only server-side (worker environment); never sent to the browser or exposed via `NEXT_PUBLIC_*` variables.                                                                                                                                                    | Planned            |
| AI request safety            | Timeouts, bounded retries, cost and size limits per request and workspace.                                                                                                                                                                                           | Planned            |
| Duplicate jobs               | Database-level unique idempotency key plus queue-level job IDs.                                                                                                                                                                                                      | Planned            |
| Concurrent updates           | Member changes lock the workspace row (`SELECT … FOR UPDATE`) so the last-owner check can't race (**Implemented**). Optimistic locking on reviews, row locks for status recomputation and idempotent resolution come later.                                          | Partly implemented |
| Transport and headers        | HTTPS in deployment (Vercel and Render) and no CORS needed, since the browser only talks to the web app's origin (**Implemented**). Security headers (e.g. `@fastify/helmet`) come later.                                                                            | Partly implemented |
| Information leakage          | Generic `500` messages to clients with details only in server logs, and one error for unknown email or wrong password (**Implemented**). `404` for inaccessible resources comes with authorization.                                                                  | Partly implemented |
