---
'intellibrix': major
'@intellibrix/ai-sdk': major
'@intellibrix/mcp': major
'@intellibrix/structures': major
'@intellibrix/sql': major
'@intellibrix/memory-sqlite': major
'@intellibrix/express': major
'@intellibrix/terminal': major
'@intellibrix/i18n': major
'@intellibrix/workspace': major
'@intellibrix/agent-tools': major
'@intellibrix/sandbox': major
'@intellibrix/github': major
'@intellibrix/cli': major
---

intellibrix 1.0: a clean-break modernization.

- Provider-agnostic `Intelligence` with a typed agent loop, tools, structured output, streaming, memory, approvals, usage/cost accounting, OpenTelemetry spans, checkpoints and record/replay (replaces the OpenAI-3-specific `Intelligence`).
- Programs expose input/output schemas and double as tools; `brick.ask()`, `brick.use()`.
- `@intellibrix/ai-sdk`, `@intellibrix/mcp`, `@intellibrix/structures`, `@intellibrix/memory-sqlite`, `@intellibrix/workspace`, `@intellibrix/sandbox`, `@intellibrix/github` and `@intellibrix/cli` are new.
- `@intellibrix/agent-tools` gives coding agents `apply_patch` (all-or-nothing unified diffs), `run_checks` (structured test, typecheck and lint results), `todo`, `calculator`, `datetime`, `json_query`, `diff`, an opt-in `memory` tool over any `KeyValueStore`, `web_search`, `ask_user` and `delegate`. `fetch_url` returns the main content of a page as Markdown, can honor `robots.txt`, and checks addresses at connect time to block SSRF.
- `@intellibrix/workspace` writes files atomically under a per-file lock, supports partial reads (`offset`, `limit`, `lineNumbers`), and has an opt-in `FileTracker` that refuses writes to files the model has not read or that changed since.
- `@intellibrix/sandbox` can run code in a local Podman or Docker container (`containerProvider`) with no network, dropped capabilities and resource limits.
- Express, Terminal and I18n bricks are now standalone packages; SQL moved to `@intellibrix/sql` with pgvector support.
- Fixes: `Brick` honors `options.id`; `schedule()` passes `onComplete` as a callback and honors `start: false`; one shared logger instead of a pino-pretty worker per brick; `ExpressBrick` port `0`; per-instance i18next.

See MIGRATION.md for the full 0.x to 1.0 mapping.
