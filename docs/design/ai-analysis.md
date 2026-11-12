# AI Analysis

How AI review works: the request, the job queue, the worker, the model call and how its output is checked before anyone sees it. **Implemented (Stage 8A, backend).** The review UI for findings is Stage 8B.

[← Back to README](../../README.md)

---

## At a glance

- Any workspace **member** (not a viewer) can start an analysis of an **open** review. Routes: [api.md](../api.md#ai-analysis).
- Jobs run on a **BullMQ** queue (`ai-analysis`) in Redis. The worker runs **inside the API process**, started only when the server listens.
- **One model call per job** (plus at most one repair call), not one per file: free tiers allow only a few requests per minute.
- The provider is anything that speaks the **OpenAI chat completions API** (Groq, Cerebras, OpenRouter, Gemini's OpenAI endpoint, …), called with the official `openai` SDK and a configurable `baseURL`. A **fake** provider gives deterministic findings without network access, for development and tests.
- Model output is **untrusted**: it is validated with Zod and every finding must point to lines that exist in the analyzed diff, or it is dropped.
- The database row is the user-visible state. BullMQ is only the delivery mechanism.

## Configuration

| Variable                                | Default                             | Notes                                                                                             |
| --------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------- |
| `AI_PROVIDER`                           | `fake` (dev/test), required in prod | `openai_compatible`, `fake` or `disabled` (`POST …/analyses` answers `503 ai_disabled`).          |
| `AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL` | —                                   | Required for `openai_compatible`. The key is never logged; config errors name it, never print it. |
| `AI_MAX_OUTPUT_TOKENS`                  | `8000`                              | Generous on purpose: reasoning models (e.g. `openai/gpt-oss-120b`) think before answering.        |
| `AI_MAX_JOBS_PER_WORKSPACE_PER_DAY`     | `20`                                | Rolling 24 hours, counting every job created (also failed ones).                                  |
| `AI_WORKER_CONCURRENCY`                 | `1`                                 | Jobs one API instance works on at once.                                                           |
| `AI_TIMEOUT_MS`                         | `60000`                             | Per model call. The SDK's own retries are off; BullMQ owns retries.                               |

Provider examples (all OpenAI-compatible):

| Provider   | `AI_BASE_URL`                                             | Example `AI_MODEL`         |
| ---------- | --------------------------------------------------------- | -------------------------- |
| Groq       | `https://api.groq.com/openai/v1`                          | `openai/gpt-oss-120b`      |
| Cerebras   | `https://api.cerebras.ai/v1`                              | `gpt-oss-120b`             |
| OpenRouter | `https://openrouter.ai/api/v1`                            | `openai/gpt-oss-120b:free` |
| Gemini     | `https://generativelanguage.googleapis.com/v1beta/openai` | `gemini-2.5-flash`         |

> [!WARNING]
> Free tiers have small rate limits and **may use prompts for training**. Don't send private code to a free tier. Redaction (below) masks likely secrets, not the code itself.

## Pipeline

```mermaid
sequenceDiagram
    autonumber
    actor U as Member
    participant API as Fastify API
    participant DB as PostgreSQL
    participant Q as Redis / BullMQ
    participant W as Worker (in the API process)
    participant LLM as OpenAI-compatible API
    participant IO as Socket.IO

    U->>API: POST …/reviews/:n/analyses
    API->>API: Membership, AI enabled (else 503), review open (else 409)
    API->>DB: BEGIN, advisory lock on the workspace
    alt Active job with the same idempotency key
        API-->>U: 200 existing job
    else Daily limit reached
        API-->>U: 429 + Retry-After
    else New job
        API->>DB: INSERT ai_analysis_jobs (queued), COMMIT
        API->>Q: add(jobId = job id)
        API->>IO: analysis:status (queued)
        API-->>U: 202 job
    end

    Q->>W: Deliver job
    W->>DB: UPDATE … SET running WHERE status = 'queued' RETURNING
    Note over W: No row: someone else has it, or it finished. Stop.
    W->>IO: analysis:status (running)
    W->>DB: Load review_files
    W->>W: Pick files, apply budget, redact secrets, build prompt
    W->>LLM: One chat completion (json_object, timeout)
    alt Retryable (timeout, 429, 5xx, network) and attempts left
        W->>DB: status = queued, error_code
        W->>IO: analysis:status (queued)
        Note over W,Q: BullMQ retries after Retry-After or exponential backoff
    else Non-retryable, or invalid output after one repair, or last attempt
        W->>DB: status = failed, error_code
        W->>IO: analysis:status (failed)
    else Valid output
        W->>W: Map findings to diff lines, count dropped ones
        W->>DB: BEGIN, findings + succeeded + token usage, COMMIT
        W->>IO: analysis:status (succeeded), analysis:completed
        U->>API: GET …/analyses/latest
    end
```

### 1. Request and de-duplication

- **Idempotency key:** `sha256(JSON[review_id, prompt_version, model])`. A partial unique index on `idempotency_key WHERE status IN ('queued','running')` guarantees at most one active job per key; once a job finishes, the same review can be analyzed again.
- **Daily limit:** the request transaction takes `pg_advisory_xact_lock(hashtextextended('ai-analysis:' || workspace_id, 0))`, so two concurrent requests in one workspace can't both pass the count. Over the limit, the response is `429 analysis_limit_reached` with `Retry-After` set to when the oldest counted job leaves the 24-hour window. Returning an active job never counts.
- **Enqueue after commit**, with BullMQ `jobId` = the job's id, so a worker never receives an id whose row isn't visible yet, and adding the same id twice is a no-op. If Redis is unreachable the request still returns `202`; the sweeper enqueues the job later.

### 2. Context assembly

`modules/ai/context.ts`, in review file order:

- **Skipped:** binary files, deleted files, lockfiles (`pnpm-lock.yaml`, `package-lock.json`, `yarn.lock`, `bun.lock`, `Cargo.lock`, `poetry.lock`, `go.sum`, …), minified or generated files (`*.min.js`, `*.min.css`, source maps, or any line over 1,000 characters), files without line changes, and files with more than 1,000 changed lines.
- **Budget:** 1,500 changed lines in total. Files are taken in order until the next one would not fit; the rest are skipped and the stored summary says "Only the first N of M files were analyzed…". Skipped files are also counted in the summary ("Skipped files: 1 lockfile, 1 binary.").
- If nothing is left to analyze, the job succeeds with no findings and no model call.

### 3. Redaction

`modules/ai/redact.ts` masks likely secrets with `[REDACTED]` before anything leaves the server: AWS access key ids, private key blocks (every line from `BEGIN … PRIVATE KEY` to `END`), GitHub, Slack (tokens and webhooks) and Stripe tokens, `sk-…` and `gsk_…` keys, Google API keys, credentials in URLs, quoted values assigned to names containing `key`/`secret`/`password`/`token`, and `.env`-style `KEY=`/`SECRET=`/`PASSWORD=`/`TOKEN=` lines. Line numbers are unchanged, so findings still map. It errs on the side of masking (`const keyboard = "x"` loses its value too).

### 4. Prompt

`modules/ai/prompt.ts`, versioned by `PROMPT_VERSION` (`review-v1`; part of the idempotency key, so bump it when the prompt or the output shape changes).

- The diff is **untrusted data** between `DIFF-<random> BEGIN` / `DIFF-<random> END` lines. The delimiter is random per call, so code in the diff can't fake the end of the block. The system prompt says never to follow instructions found in the code, comments, strings or file names.
- Only real **bugs**, **security** and **performance** issues; no style or naming nitpicks. An empty `findings` array is explicitly a valid answer.
- Every diff line carries its number: `new 12 + added`, `old 7 - deleted`, `new 13   context`. The model is told to use the new side for added and context lines and the old side for deleted lines.
- The system prompt contains the exact JSON shape; the request uses `response_format: { type: "json_object" }` and `temperature: 0`.

### 5. Provider

```ts
interface AiProvider {
  readonly model: string;
  analyze(input: AnalyzeInput): Promise<{ result: unknown; raw: string; usage: TokenUsage | null }>;
}
```

- **`openai_compatible`** (`providers/openai-compatible.ts`): the official `openai` SDK with `baseURL`, `timeout` and `maxRetries: 0`; `max_completion_tokens` from config; token usage read from `usage` when the provider sends it. A response with `finish_reason: "length"` (cut off — common with reasoning models and a low limit) or empty content is **invalid output**, even if it happens to parse. A JSON object wrapped in a code fence is accepted.
- **`fake`** (`providers/fake.ts`): no network; one low-severity finding on the first added line of each of the first three analyzed files.

### 6. Output validation and mapping

- `AiAnalysisResultSchema` (`packages/shared/src/ai.ts`): `summary` ≤ 4,000 characters, at most 100 findings; each finding has `category` (`bug` | `security` | `performance`), `severity` (`info` … `critical`), `title` ≤ 200, `explanation` ≤ 4,000, optional `suggestion` ≤ 4,000, optional `file`, `side`, `lineStart`, `lineEnd` (positive integers) and `confidence` 0–1. The design's earlier `quality` category was dropped: it invites the style nitpicks the prompt forbids.
- **One repair attempt:** if the output is cut off, empty, not JSON or fails the schema, the model is called once more with its previous answer and the problem (Zod paths and messages only). Still invalid → `failed` / `invalid_output`, no retry.
- **Mapping** (`mapping.ts`): the file must be one of the analyzed files (matched by new or old path, `a/` `b/` `./` prefixes tolerated); the side is the given one, or inferred (new if the line exists there); `lineEnd` defaults to `lineStart`; both ends must exist on that side **within one hunk**. Anything else, including findings with no file or line, is dropped and counted in `dropped_findings`.
- **Persistence:** in one transaction, `UPDATE … SET succeeded … WHERE status = 'running' RETURNING`, delete any findings for the job, insert the new ones. If the update finds no row (the sweeper failed the job meanwhile), the transaction stores nothing.

### 7. Retries and failures

| Error                                      | `error_code`                                                                                | Retried?                   |
| ------------------------------------------ | ------------------------------------------------------------------------------------------- | -------------------------- |
| Timeout (client timeout, abort, HTTP 408)  | `provider_timeout`                                                                          | Yes                        |
| Network failure                            | `provider_unavailable`                                                                      | Yes                        |
| HTTP 429                                   | `provider_rate_limited`                                                                     | Yes, after `Retry-After`\* |
| HTTP 5xx, 409                              | `provider_error`                                                                            | Yes                        |
| Any other error (e.g. the database)        | `internal_error`                                                                            | Yes                        |
| HTTP 400 / 401, 403 / 404 / other 4xx      | `provider_bad_request` / `provider_auth` / `provider_model_not_found` / `provider_rejected` | No                         |
| Invalid output after the repair attempt    | `invalid_output`                                                                            | No                         |
| Running for more than 10 minutes (sweeper) | `timed_out`                                                                                 | No                         |

- **Attempts:** 3. Each start increments `attempts`; a retryable error on attempt 1 or 2 sets the row back to `queued` (with the error code) and throws, and BullMQ re-delivers after a delay. On the last attempt the job fails with that error code.
- **Delay:** `Retry-After` / `retry-after-ms` when the provider sends one (clamped to 1 s – 5 min), otherwise 5 s doubling, ±20 % jitter. \*A `Retry-After` over 5 minutes (typically a daily quota) fails the job at once instead of holding it.
- **Two workers, one job:** the claim is `UPDATE … SET status = 'running' WHERE id = $1 AND status = 'queued' RETURNING`. Only one gets a row; the other stops. Every later update is conditional on `status = 'running'`, so a late worker can never overwrite a job the sweeper already failed.
- **Sweeper** (every minute, on every instance; all of its writes are conditional, so instances don't conflict): re-enqueues jobs `queued` for more than 2 minutes since creation (a crash between commit and enqueue; re-adding a job BullMQ still holds is a no-op), and fails jobs `running` for more than 10 minutes since their last start with `timed_out`.
- **BullMQ jobs are removed when finished** (`removeOnComplete`/`removeOnFail`): the outcome lives in Postgres, and a freed id lets the sweeper enqueue it again if needed.
- **Shutdown:** `preClose` stops the sweeper, waits for in-flight jobs (`worker.close()`), then closes the queue. The AI plugin is registered before the realtime plugin, so the last status events still go out before Socket.IO closes.

### 8. Events

Published to the review room after each committed status change, best effort (a failed publish is logged, never fails the job):

- `analysis:status` — `{ reviewId, actorId, at, job }` on `queued` (from the request, `actorId` = requester), `running`, back to `queued` for a retry, `succeeded` and `failed` (`actorId: null`).
- `analysis:completed` — `{ reviewId, actorId: null, at, jobId, findings }` after a job succeeds. Clients then call `GET …/analyses/latest`.

### Logging

Logged: job id, review id, attempt, durations, file and finding counts, token counts, error codes and `Retry-After`. **Never** logged: diff content, prompts, model output, provider error bodies (they can echo the prompt; `ProviderError` messages are just the code) or the API key.

## Data model

- `ai_analysis_jobs`: `id` (uuidv7), `workspace_id`, `review_id` (cascade), `requested_by` (set null), `status` (`queued` | `running` | `succeeded` | `failed`), `idempotency_key`, `prompt_version`, `model`, `attempts`, `error_code`, `summary`, `input_tokens`, `output_tokens` (summed over every call, including failed attempts and repairs), `dropped_findings`, `created_at`, `started_at` (last start), `finished_at`. Indexes: the partial unique key, `(review_id, created_at desc)`, `(workspace_id, created_at)` for the daily limit, and a partial index on active statuses for the sweeper.
- `ai_findings`: `id`, `job_id` / `review_id` / `review_file_id` (cascade), `side`, `line_start`, `line_end`, `category`, `severity`, `title`, `explanation`, `suggestion`, `confidence` (0–1 check), `dismissed_at`, `created_at`. Indexes on `review_id`, `job_id`, `review_file_id`.

## Not built yet

- The findings UI (Stage 8B): showing findings on lines, labeled as AI-generated, dismissing and converting a finding into a thread.
- Cancelling a job, analyzing a subset of files, and splitting very large reviews over several calls.
- A separate worker process; today every API instance runs a worker.
