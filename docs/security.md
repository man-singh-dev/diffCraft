# Security

How authentication and authorization work, rate limiting and security headers, and the status of each security safeguard.

[← Back to README](../README.md)

---

## Authentication and Authorization

> Status: **Implemented** for authentication (Stage 1), the workspace role guard and member management (Stage 2), the review author rule (Stage 3), reviewer assignment and approval rules (Stage 6), and socket rooms (Stage 7). Invitations are **Planned**.

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
- **Rate limits** on login (per IP and per email) and registration (per IP): see [Rate limiting](#rate-limiting-and-security-headers-implemented).
- **Not yet:** registration still reveals whether an email is taken (`409`). See [Known Limitations](../README.md#known-limitations).

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

- Every new protected route keeps the rule the existing ones (AI findings included) follow: resolve the target resource **with its workspace** and check membership before any other logic, never trusting a `workspaceId` supplied by the client alone.

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

### Real-time (Implemented)

Sockets connect straight to the API (the web app's `/api` rewrite can't carry WebSockets, and the session cookie belongs to the web domain). See [architecture](architecture.md#real-time).

- **Tickets, not cookies.** `POST /api/v1/realtime/ticket` needs a session (`requireAuth`) and passes the same CSRF Origin check as every other `POST`. It returns 32 random bytes (base64url, 43 characters) with `Cache-Control: no-store`. Redis stores only `SHA-256(ticket) -> { userId, sessionId }`, with `SET ... EX 30 NX`, so whoever can read Redis can't connect as anyone. `sessionId` is the session's database id (the SHA-256 of the cookie token, never the token itself).
- **Single use, atomically.** The handshake checks the format and then takes the ticket with `GETDEL`: of two connections racing with one ticket, only one gets the user. The session the ticket was issued for must still exist and not be expired, so a ticket fetched just before logging out is useless. A missing, malformed, unknown, expired or used ticket fails with the same generic `unauthorized`.
- **Origin check.** Browsers don't apply CORS to WebSocket upgrades, so `allowRequest` refuses any upgrade whose `Origin` isn't exactly `WEB_ORIGIN` (before the ticket is touched). Socket.IO's CORS is set to the same origin, without credentials. Tickets aren't cookies, so a cross-site page can't ride a victim's session to open a socket; the check is defence in depth.
- **Room authorization.** Joining a review room uses the same service functions as the HTTP routes: membership (viewer or higher), then the review looked up **inside that workspace**. Not a member, no such workspace and no such review all get `not_found`, so ids can't be probed. Rooms are named by review id, which only the server hands out.
- **Limits.** At most 20 review rooms per socket, 10 join attempts per 10 s per socket (malformed ones count too), 16 KiB per message, and only the WebSocket transport.
- **No secrets in logs.** Tickets, session ids, tokens, cookies and comment bodies are never logged; the logger also redacts `ticket` fields, and Redis errors are logged by name and message only (a connection URL may hold a password).

### Continuous authorization for sockets (Implemented)

Checking access only when a socket connects or joins a room isn't enough: a member removed from a workspace, or a user who logs out, must stop receiving events at once, not when the socket happens to reconnect. Three mechanisms keep sockets in step with memberships and sessions (`modules/realtime/access.ts`):

1. **Revoke on membership loss.** After the commit of removing a member, leaving a workspace and deleting a workspace (all its members), the route calls `realtime.revokeWorkspaceAccess(userIds, workspaceId, reason)`. Each socket records which workspace every review room it joined belongs to (`socket.data.reviewRooms`, reviewId → workspaceId, taken from the database). Every instance takes the user's sockets from its `user:<userId>` room, leaves each review room of that workspace, sends `review:access-revoked { reviewId, reason: 'removed' | 'workspace_deleted' }` to that socket only, and recomputes presence for the affected rooms. A role change keeps access (a viewer may still watch), so it revokes nothing.
2. **Revoke on session end.** The socket keeps the session id from its ticket. After logout, a login that replaces an old session, and the deletion of an expired session found by `requireAuth`, `realtime.revokeSessions(userId, sessionIds)` disconnects (`disconnect(true)`) every socket of that session, on every instance, and no other session's. Reconnecting needs a new ticket, which needs a valid session, so the client gets `401` and stops. There is no "log out everywhere" route yet; it would call the same function.
3. **Safety net.** Every 5 minutes (`recheckIntervalMs`), each instance re-checks its own sockets in **one query** per run: every (user, workspace) pair of a joined review room against `workspace_members`, and every session id against unexpired `sessions`. Sockets whose session is gone are disconnected; rooms whose membership is gone are left with `review:access-revoked`. This catches what the first two miss: changes made directly in the database, an instance that missed a revocation, and sessions that simply expired. The check runs as a `setTimeout` chain (never two at once) and stops on shutdown.

- **Acknowledged across instances.** Revocations go to the other instances with `serverSideEmitWithAck`, and each instance evicts its own sockets before acknowledging. A remote socket's `leave()` through the Redis adapter is fire-and-forget, so with it an event emitted on the socket's own instance just after the route answered could still arrive; with the acknowledgement, once the route has answered, no instance delivers that workspace's room events to the evicted sockets.
- **Best effort, then the safety net.** Revocation runs after the commit and never fails the request. If an instance doesn't answer within 5 s (`revokeTimeoutMs`), a warning is logged (error name and message only) and the safety net evicts the rest within one interval.
- **Races closed at the edges.** A join records the room and joins it, then checks membership **again**: a removal that commits during the join is either seen by that check or finds the socket already recorded. Likewise a new connection re-checks its session after joining its user room, so a logout during the handshake can't leave a socket behind.
- **Tested** with real Redis and two listening instances: a member removed on one instance stops receiving `thread:upsert` on the other right after the response (including events emitted by the socket's own instance) and gets `review:access-revoked`, while other members and the removed user's rooms in other workspaces are unaffected; deleting a workspace evicts every member; logout disconnects only that session's sockets; the safety net evicts after a membership or session row is deleted directly; a role change to viewer keeps the socket; presence drops the removed user.

## Rate limiting and security headers (Implemented)

Code: `apps/api/src/plugins/rate-limit.ts`, `client-ip.ts`, `security-headers.ts`; `apps/web/src/proxy.ts`, `lib/csp.ts`, `next.config.ts`.

### Threats and controls

| Threat                                      | Control                                                                                                                                                                                                                                                                 |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Password brute force (one IP)               | `POST /auth/login`: 10 per minute per client IP. Argon2id makes each guess slow too.                                                                                                                                                                                    |
| Credential stuffing (one account, many IPs) | `POST /auth/login`: also 5 per 15 minutes per normalized email (trimmed, lowercased), however many IPs the attempts come from.                                                                                                                                          |
| Account and email spam                      | `POST /auth/register`: 5 per hour per IP. `POST /auth/resend-verification`: 5 per hour per user, on top of the 60-second resend throttle.                                                                                                                               |
| Content and job spam                        | Thread and reply creation: 60 per minute per user (shared). `POST …/analyses`: 5 per minute per user, on top of the daily per-workspace cap. `POST /realtime/ticket`: 30 per minute per user.                                                                           |
| General flooding                            | Every route: 300 per minute per client IP. `/health` and `/ready` are excluded, so the host's health checks never fail because of it.                                                                                                                                   |
| XSS                                         | Web: a per-request nonce CSP, `script-src 'self' 'nonce-…' 'strict-dynamic'`. Scripts never get `unsafe-inline`; `unsafe-eval` is allowed only in development. `object-src 'none'`, `base-uri 'self'`. React escaping as before. API: `default-src 'none'` on its JSON. |
| Clickjacking                                | `frame-ancestors 'none'` and `X-Frame-Options: DENY` on both the web app and the API.                                                                                                                                                                                   |
| MIME sniffing                               | `X-Content-Type-Options: nosniff` on both.                                                                                                                                                                                                                              |
| Protocol downgrade                          | `Strict-Transport-Security: max-age=31536000; includeSubDomains` in production on both, and `upgrade-insecure-requests` in the web CSP in production over HTTPS.                                                                                                        |
| Data left in caches                         | The API sends `Cache-Control: no-store` on every response unless a route sets its own, so no browser or shared cache keeps per-user data.                                                                                                                               |
| Referrer leaks                              | Web: `strict-origin-when-cross-origin`, and `no-referrer` on `/verify-email` (its token is in the URL). API: `no-referrer`.                                                                                                                                             |
| Browser features                            | `Permissions-Policy: camera=(), microphone=(), geolocation=()`.                                                                                                                                                                                                         |

### How limiting works

- **`@fastify/rate-limit` with a Redis store**, so every API instance shares the same counters (tested with two app instances). Counters use fixed windows: `INCR` plus `PEXPIRE` in one Lua script. A key is `RATE_LIMIT_PREFIX`, the limit's name and the SHA-256 of the identity, so Redis never holds an email or an IP.
- **Keys:** the user id on authenticated routes, otherwise the client IP. IPv6 addresses are grouped by /64, so one host can't rotate through its own /64. Login and registration run before anyone is authenticated, so they are keyed by IP and email.
- **The global limit** runs on `onRequest`, by IP. The route limits run in `preHandler`, after authentication. They're built with the plugin's `createRateLimit` rather than its `rateLimit()`: the plugin runs only one limiter per request, so a route limit would otherwise be skipped after the global one. Login counts every attempt, invalid bodies included.
- **Response:** `429 { error: { code: 'rate_limited', message, details: { retryAfterSeconds } } }`, with `Retry-After` and the draft `RateLimit-Limit` / `RateLimit-Remaining` / `RateLimit-Reset` headers. The web shows a friendly message on login, register, comments and the AI card. On the AI card, the burst limit reads differently from the daily cap.
- **Logs:** a warning with the limit's name, the first 8 characters of the hashed key and a truncated IP (`203.0.113.x`). Never an email or a full IP. The request logger also truncates IPs.
- **Configurable:** each limit has an env var (see [deployment](deployment.md#rate-limiting)). `RATE_LIMIT_ENABLED=false` turns limiting off (the tests do this); production then logs a warning.

### When Redis is down

- Rate limiting has **its own Redis connection, with no offline queue** and a 1-second command timeout. While Redis is down, a command fails at once instead of adding seconds to every request. At startup the API waits at most 2 seconds for this connection.
- **General limits fail open:** the global, content, ticket and analysis limits let the request through. Failing closed would turn a Redis outage into a full API outage. Tickets and the AI queue need Redis anyway, so those features are already down.
- **Auth limits fall back to per-instance memory counters:** login per IP and per email, and registration. Failing closed would lock everyone out of login during the outage. Failing open would leave login unprotected exactly when an attacker might be causing that outage. With memory counters each instance keeps the same limits: with N instances an attacker gets at most N times the budget, and legitimate users are never blocked beyond the normal limits. The memory store keeps at most 10,000 keys.
- At most one warning per minute, with the error's name and message only (a Redis URL may hold a password). Tested: with Redis unreachable, general requests pass and the login limit still answers `429`.

### The real client IP

Per-IP limits are only as good as the IP they count. **Trusting `X-Forwarded-For` blindly is dangerous.** Anyone can send the header, so an API that believes its first entry lets an attacker claim a new "IP" on every request, which means unlimited login attempts. They could also put someone else's IP there and get that person locked out. Render adds to the header rather than replacing it, so whatever the client sent is still in the list.

- **Direct requests (through Render's proxy).** In production, Fastify's `trustProxy` is `TRUST_PROXY`; elsewhere it is off. The default, `uniquelocal`, works because Render's proxy connects from a private address. Fastify walks `X-Forwarded-For` from the right and stops at the first address that isn't a trusted proxy, so anything a client put in front is ignored (tested). `TRUST_PROXY` also accepts IPs, CIDRs or a hop count. Never set it to `true`.
- **Requests through the web app.** Almost all traffic reaches the API from Vercel: the `/api/*` rewrite (login, register) as well as Server Components and Server Actions. To the API all of it comes from Vercel's addresses, so per-IP limits would treat every user as one and lock everyone out together. The web server therefore sends the client IP in `x-diffcraft-client-ip`, along with `x-diffcraft-proxy-secret` set to `WEB_PROXY_SECRET`, a random value both apps share. The API believes the header only if the secret matches (compared in constant time) and the value is a valid IP. Otherwise it uses `request.ip` (tested). `WEB_PROXY_SECRET` is required in production while rate limiting is on.
- **Where the web gets the IP:** from the first `X-Forwarded-For` entry. Vercel overwrites that header with the address that connected to it, so a client can't choose the value. On a host that doesn't overwrite it, a client could. The web proxy also deletes any `x-diffcraft-*` header a client sends before the request is rewritten to the API.

### Content Security Policy (web)

- `src/proxy.ts` (Next.js 16's name for middleware) generates a 128-bit nonce per request and puts the CSP on both the response and the request. Next.js reads the nonce from the request's CSP and adds it to its own scripts and inline bootstrap. `'strict-dynamic'` lets those scripts load the chunks they need; it also makes browsers ignore `'self'` for scripts.
- **Every page is rendered per request:** the root layout calls `connection()`. A page rendered at build time would have no nonce, and the CSP would block its scripts.
- **`style-src 'self' 'unsafe-inline'`:** Shiki colors every token through a `style` attribute, and React writes `style` attributes as well. A nonce can't cover `style` attributes, so styles need `unsafe-inline`. Injected CSS can restyle a page but can't run code, and scripts never get `unsafe-inline`.
- **`connect-src 'self'` plus the realtime origin** from `NEXT_PUBLIC_REALTIME_URL`, as both `https://` and `wss://` (`http://` and `ws://` locally), because Socket.IO connects straight to the API. Server Actions post to the page's own origin, which `'self'` covers. Also `form-action 'self'`, `img-src 'self' data:` and `font-src 'self'`.
- **The static headers** (nosniff, frame deny, referrer policy, permissions policy, and HSTS in production) are set in `next.config.ts` for every path, static assets included. The CSP is set in the proxy, which skips `_next/static` and `_next/image`.
- **No violation report endpoint** yet.

## Security Considerations

> Rows marked **Implemented** exist in the code and have tests. The rest are **design goals**. No security audit has been done, and no security guarantees are claimed.

| Area                         | Safeguard                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Status             |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| Authentication               | Argon2id password hashing; hashed session tokens; HttpOnly/SameSite=Lax cookies (Secure in production); session revocation on logout; CSRF Origin check; timing-safe login. See [Authentication](#authentication-implemented).                                                                                                                                                                                                                                              | **Implemented**    |
| Resource-level authorization | Membership and role checks on every route and socket room, with resources loaded through their workspace. `requireWorkspaceRole` guards every `/api/v1/workspaces/:workspaceId` route, with `404` for non-members, review routes included, joining a review room re-checks membership, and sockets are evicted or disconnected as soon as the membership or session ends ([continuous authorization](#continuous-authorization-for-sockets-implemented)) (**Implemented**). | **Implemented**    |
| Input validation             | Zod schemas for request bodies, list queries and environment variables (unknown fields are stripped, not rejected). Socket payloads are validated with shared Zod schemas on both sides.                                                                                                                                                                                                                                                                                    | **Implemented**    |
| SQL injection                | All queries through Drizzle's parameterized query builder; no string-concatenated SQL.                                                                                                                                                                                                                                                                                                                                                                                      | **Implemented**    |
| Rate limiting                | `@fastify/rate-limit` with shared Redis counters: global per IP, login per IP and per email, registration per IP, and per-user limits on tickets, comments, analyses and verification resends. See [Rate limiting](#rate-limiting-and-security-headers-implemented).                                                                                                                                                                                                        | **Implemented**    |
| Submitted code               | Treated strictly as text: never executed, compiled or evaluated. Size, file, line and encoding limits on patches (**Implemented**). Rendered with escaping (no `dangerouslySetInnerHTML` for code or comments).                                                                                                                                                                                                                                                             | Partly implemented |
| Prompt injection             | The diff is sent as untrusted data between random, unguessable delimiters, with instructions never to follow anything inside it. Model output can't trigger actions: it is validated with Zod and every finding must point to a line that exists in the diff, or it is dropped. See [design/ai-analysis.md](design/ai-analysis.md).                                                                                                                                         | **Implemented**    |
| Secret disclosure            | `.env` files git-ignored, secrets loaded from the environment only, and config errors list variable names, never values. Likely secrets in the diff are redacted before the LLM call, and logs never include code, prompts or model output.                                                                                                                                                                                                                                 | **Implemented**    |
| LLM API keys                 | `AI_API_KEY` lives only in the API's environment (the worker runs in the API process); it is never sent to the browser, never in a `NEXT_PUBLIC_*` variable and never logged.                                                                                                                                                                                                                                                                                               | **Implemented**    |
| AI request safety            | Per-call timeout (`AI_TIMEOUT_MS`), bounded retries with backoff, a per-workspace daily job limit, bounded context (per-file and total changed-line limits and a line-length limit; lockfiles, minified and binary files skipped) and a per-user rate limit on starting analyses.                                                                                                                                                                                           | **Implemented**    |
| Duplicate jobs               | A partial unique index on the active job's idempotency key, plus the BullMQ job ID set to the database job's ID.                                                                                                                                                                                                                                                                                                                                                            | **Implemented**    |
| Concurrent updates           | Member changes lock the workspace row (`SELECT … FOR UPDATE`) so the last-owner check can't race. Decisions, reviewer changes, status changes and merge lock the review row, so merge rules are re-checked against committed state (covered by a race test). Optimistic locking for concurrent review edits is planned.                                                                                                                                                     | Partly implemented |
| Transport and headers        | HTTPS in deployment (Vercel and Render) and no CORS needed for HTTP, since the browser only talks to the web app's origin; the Socket.IO endpoint accepts only `WEB_ORIGIN` (**Implemented**). Security headers on both apps: a nonce-based CSP on the web, `@fastify/helmet` on the API, HSTS in production (**Implemented**).                                                                                                                                             | **Implemented**    |
| Information leakage          | Generic `500` messages to clients with details only in server logs, one error for unknown email or wrong password, and `404` (not `403`) for workspaces and reviews the caller can't see. Registration still answers `409` for an existing email (a known limitation).                                                                                                                                                                                                      | Partly implemented |
