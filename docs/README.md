# DiffCraft Documentation

An index of the detailed docs. Start with the [main README](../README.md) for an overview.

[← Back to README](../README.md)

---

| File                                           | What it covers                                                                      | Status                       |
| ---------------------------------------------- | ----------------------------------------------------------------------------------- | ---------------------------- |
| [architecture.md](architecture.md)             | Components, data flow, real-time, outbox, diff engine, lifecycle, deployment.       | Mixed (labelled per section) |
| [database.md](database.md)                     | Tables, constraints, indexes, transactions, concurrency, pagination.                | Mixed (labelled per section) |
| [api.md](api.md)                               | API conventions, every endpoint, socket events and payloads.                        | Mixed (labelled per section) |
| [security.md](security.md)                     | Authentication, authorization, rate limiting, security headers and safeguards.      | Mixed (labelled per section) |
| [development.md](development.md)               | Full local setup, environment variables, Docker, project structure, testing.        | **Implemented**              |
| [deployment.md](deployment.md)                 | Vercel, Render (web service + Key Value) and Neon setup, and each host's variables. | **Implemented**              |
| [design/realtime.md](design/realtime.md)       | Socket.IO rooms, events, delivery guarantees and the comment broadcast sequence.    | **Implemented** (Stage 7)    |
| [design/ai-analysis.md](design/ai-analysis.md) | AI analysis pipeline, background jobs and failure handling.                         | **Implemented** (Stage 8)    |
| [roadmap.md](roadmap.md)                       | Detailed current status, the full roadmap and future enhancements.                  | —                            |

Status labels used throughout: **Implemented** · **In progress** · **Planned**.
