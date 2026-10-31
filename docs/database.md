# Database

The database design: implemented and proposed tables, constraints, indexes, transactions, concurrency and pagination.

[← Back to README](../README.md)

---

## Database Design

> [!NOTE]
> **Implemented:** the `users`, `sessions`, `workspaces`, `workspace_members`, `reviews` and `review_files` tables (Drizzle schema in `apps/api/src/db/schema`, migrations in `apps/api/drizzle`). The workspace tables are served by `/api/v1/workspaces` (see [api.md](api.md#workspaces-and-membership)). The review tables have a service but no routes yet (see [architecture.md](architecture.md#reviews)). Every other table below is a **proposal**. It will change during implementation and will not be considered final until it exists as Drizzle schema and migrations.

### Entity-relationship diagram (`users`, `sessions`, `workspaces`, `workspace_members`, `reviews` and `review_files` implemented; the rest proposed)

```mermaid
erDiagram
    users ||--o{ sessions : "has"
    users ||--o{ workspace_members : "has"
    workspaces ||--o{ workspace_members : "has"
    users |o--o{ workspaces : "created"
    workspaces ||--o{ reviews : "contains"
    users |o--o{ reviews : "authors"
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
        uuid id PK "uuidv7()"
        text name
        text slug UK
        uuid created_by FK "nullable, ON DELETE SET NULL"
        int last_review_number "default 0; hands out reviews.number"
        timestamptz created_at
        timestamptz updated_at
    }
    workspace_members {
        uuid workspace_id PK, FK "ON DELETE CASCADE"
        uuid user_id PK, FK "ON DELETE CASCADE"
        text role "CHECK: owner | admin | member | viewer"
        timestamptz joined_at
    }
    reviews {
        uuid id PK "uuidv7()"
        uuid workspace_id FK "ON DELETE CASCADE"
        int number "UNIQUE with workspace_id"
        uuid author_id FK "nullable, ON DELETE SET NULL"
        text title
        text description "nullable"
        text status "CHECK: open | closed"
        text patch "raw upload"
        int files_changed
        int additions
        int deletions
        timestamptz created_at
        timestamptz updated_at
    }
    review_files {
        uuid id PK "uuidv7()"
        uuid review_id FK "ON DELETE CASCADE"
        int position "0-based, UNIQUE with review_id"
        text old_path "nullable"
        text new_path "nullable"
        text change_type "CHECK: added | deleted | modified | renamed"
        boolean is_binary
        int additions
        int deletions
        jsonb hunks "parsed DiffHunk[]"
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

| Table               | Responsibility                                                                                                                                                                                                                                                                                                                                                     |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `users`             | Identity and credentials (password hash only; never plaintext). **Implemented.**                                                                                                                                                                                                                                                                                   |
| `sessions`          | Server-side sessions. Stores only a SHA-256 hash of each token, with a 7-day absolute expiry. Cascades on user delete. **Implemented.**                                                                                                                                                                                                                            |
| `workspaces`        | Top-level tenancy boundary. Every review will belong to exactly one workspace. `slug` is derived from the name (lowercase letters, digits and hyphens, at most 40 characters, with a random 4-character suffix on collision). `created_by` becomes `NULL` if the creator's account is deleted, so the workspace survives. **Implemented.**                         |
| `workspace_members` | Join table between users and workspaces carrying the member's **role** (`owner`, `admin`, `member` or `viewer`, enforced by a `CHECK` constraint). The basis for authorization. Rows are deleted with their workspace or their user. **Implemented.**                                                                                                              |
| `reviews`           | A unit of review: an uploaded patch with title, description, author and status (`open` or `closed`). Numbered 1, 2, 3 … per workspace from `workspaces.last_review_number`. Keeps the raw patch and file/addition/deletion totals. The author becomes `NULL` if their account is deleted. **Implemented**; revisions and an optimistic-lock `version` are planned. |
| `review_files`      | One row per file of a review, in patch order (`position`): paths, change type, binary flag, line counts and the parsed hunks as `jsonb` (always read whole, never queried into). **Implemented**; a `revision` column is planned.                                                                                                                                  |
| `review_comments`   | Line-anchored or review-level comments. `parent_comment_id` (self-reference) forms threads; resolution is stored on the thread root.                                                                                                                                                                                                                               |
| `review_approvals`  | Reviewer decisions per revision (`approved` / `changes_requested`). A new revision invalidates earlier decisions by default.                                                                                                                                                                                                                                       |
| `ai_analysis_jobs`  | Lifecycle and audit record for each analysis request: status, attempts, error code, model and prompt version.                                                                                                                                                                                                                                                      |
| `ai_findings`       | Structured findings from a job, linked to the review and — when applicable — a specific file, side and line range.                                                                                                                                                                                                                                                 |

Reviewer assignment and notifications will likely require additional tables (`review_reviewers`, `notifications`), which are included in the roadmap.

### Foreign keys and referential integrity

- All relationships are enforced with foreign keys; application code does not rely on "soft" references.
- **Implemented:** `ON DELETE CASCADE` from `users` to `sessions`, and from `workspaces` and `users` to `workspace_members`. `ON DELETE SET NULL` from `users` to `workspaces.created_by`, so deleting an account never deletes a shared workspace.
- **Implemented:** `ON DELETE CASCADE` from `workspaces` to `reviews` and from `reviews` to `review_files`. `ON DELETE SET NULL` from `users` to `reviews.author_id`, so a review survives its author's account.
- `ON DELETE CASCADE` from `reviews` to `review_comments`, `review_approvals`, `ai_analysis_jobs` and `ai_findings`, so deleting a review cannot leave orphans.
- `ON DELETE RESTRICT` (or soft-delete) for `users` referenced as comment authors, so history is not silently lost.
- Comments use soft deletion (`deleted_at`) so that replies in a thread remain coherent.
- **Implemented:** `CHECK` constraints `workspace_members_role_check` (the four roles), `reviews_status_check` (`open`, `closed`) and `review_files_change_type_check`. Each list comes from a shared `as const` array.
- `CHECK` constraints: `line_end >= line_start`; line fields are either all null or all set; `parent_comment_id <> id`.
- Replies must belong to the same review as their parent; enforced in the service layer (and optionally by a composite foreign key on `(review_id, parent_comment_id)`).

### Unique constraints

| Constraint                                               | Purpose                                                                                        |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `users(lower(email))`                                    | One account per email address, case-insensitive. **Implemented.**                              |
| `workspaces(slug)`                                       | Stable, unique URLs. **Implemented** (`workspaces_slug_unique`).                               |
| `workspace_members(workspace_id, user_id)` (primary key) | A user has exactly one role per workspace. **Implemented.**                                    |
| `reviews(workspace_id, number)`                          | One review per number in a workspace. **Implemented** (`reviews_workspace_id_number_unique`).  |
| `review_files(review_id, position)`                      | One file per position in a review. **Implemented** (`review_files_review_id_position_unique`). |
| `review_approvals(review_id, reviewer_id, revision)`     | One decision per reviewer per revision (updates replace it).                                   |
| `ai_analysis_jobs(idempotency_key)`                      | Prevents duplicate jobs for the same review revision, analysis type and prompt version.        |

### Indexes for common access patterns

| Access pattern                                      | Index                                                                                                                                           |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| List reviews in a workspace, newest first           | `reviews(workspace_id, created_at DESC, id DESC)` (`reviews_workspace_id_created_at_id_idx`), for a `(created_at, id)` cursor. **Implemented.** |
| Reviews by author (and the `author_id` foreign key) | `reviews(author_id)` (`reviews_author_id_idx`). **Implemented.**                                                                                |
| Files of a review in order                          | The `review_files(review_id, position)` unique index. **Implemented.**                                                                          |
| Load all comments for a review                      | `review_comments(review_id, created_at, id)`                                                                                                    |
| Load comments for a file in the diff viewer         | `review_comments(review_file_id, line_start)`                                                                                                   |
| Load replies for a thread                           | `review_comments(parent_comment_id)`                                                                                                            |
| Count unresolved threads                            | Partial index `review_comments(review_id) WHERE parent_comment_id IS NULL AND resolved_at IS NULL AND deleted_at IS NULL`                       |
| Latest decisions                                    | `review_approvals(review_id, revision)`                                                                                                         |
| Active analysis jobs                                | Partial index `ai_analysis_jobs(review_id) WHERE status IN ('queued','running')`                                                                |
| Findings for a file                                 | `ai_findings(review_file_id, line_start)`                                                                                                       |
| Workspaces for a user                               | `workspace_members(user_id)` (`workspace_members_user_id_idx`). **Implemented.**                                                                |

### Transactions

Operations that change more than one row run in a single transaction, for example:

- **Creating a workspace (Implemented):** insert the `workspaces` row and the creator's `owner` membership together, so a workspace never exists without an owner. On a slug collision the whole transaction is retried with a suffixed slug (a failed statement aborts a Postgres transaction, so it can't be retried inside it).
- **Creating a review (Implemented):** the patch is parsed first, outside the transaction. Then `UPDATE workspaces SET last_review_number = last_review_number + 1 … RETURNING` takes the next number (the row lock serialises concurrent creates), and the review and all its files are inserted (the files in one multi-row `INSERT`). A failure rolls everything back, including the number.
- **Submitting a decision:** insert/update `review_approvals`, recompute and update `reviews.status`, bump `reviews.version`.
- **Submitting a new revision:** insert new `review_files`, increment `current_revision`, mark comments on changed lines `is_outdated`, set status back to `in_review`.
- **Completing an analysis:** insert all `ai_findings` and set the job to `succeeded` atomically, so clients never see a "succeeded" job with partial findings.

### Concurrency

- **Optimistic locking** on `reviews.version`: state-changing requests include the version they read, and the update uses `WHERE id = $1 AND version = $2`. A zero-row update returns `409 Conflict`, and the client re-fetches.
- **Row locks** (`SELECT … FOR UPDATE` on the review row) for status recomputation, so two simultaneous decisions cannot produce an inconsistent status.
- Thread resolution is idempotent: resolving an already-resolved thread is a no-op.

### Pagination

List endpoints use **keyset (cursor) pagination** on `(created_at, id)` or `(updated_at, id)` rather than `OFFSET`, which keeps page cost stable on large tables and avoids skipped or duplicated rows when new comments arrive while paging. Cursors are opaque, encoded tokens; page size is bounded server-side.
