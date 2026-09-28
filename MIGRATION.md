# Migration: 0.x → 1.0

This is a clean-break rewrite. This document is filled in progressively as each phase lands; it is not complete until Phase 9.

## Status

Work in progress on `feat/v1.0.0`. This table will be finalized in Phase 9, diffed against every actually-changed public symbol.

| 0.x API | 1.0 API | Notes |
|---|---|---|
| `new Intelligence({ service: 'openai', key, model })` | `new Intelligence({ provider, model })` | `Intelligence` no longer hard-wires an SDK. A `Provider` (see `provider.ts`) does one model step per call; `runAgentLoop` in `loop.ts` owns iteration. The `openai` dependency is fully removed from `intellibrix`. `@intellibrix/ai-sdk` (Phase 3) will supply real provider adapters; `customProvider(fn)` replaces `service: 'custom'` for simple cases. |
| `intelligence.ask(question, context?)` → `{text, context, function_result, finish_reason, usage}` | `intelligence.ask(prompt, options?)` → `{text, messages, steps}` (`AskResult`) | Multi-step tool loops, parallel tool calls, and approvals are now built in; a `functions` schema/methods pair is replaced by `defineTool`/`ToolDefinition[]` passed via `tools`. |
| `intelligence.image(prompt, size?)` | `intelligence.image(prompt)` | Delegates to `Provider.image()`; only available when the configured provider implements it. |
| n/a | `intelligence.object(schema, prompt)` | New: forces a structured response via a synthetic tool call, returning parsed, schema-validated input. |
| n/a | `intelligence.stream(prompt, options?)` | New: streams `StreamEvent`s from the underlying provider. |
| n/a | `intelligence.embed(input)` | New: delegates to `Provider.embed()`, when supported. |
| `new Brick({ id, ... })` (bug: `id` was ignored; always randomUUID) | `new Brick({ id, ... })` | Fixed: a provided `id` is now honored. |
| `brick.schedule({ start: false, onComplete, ... })` (bug: `start` ignored, always true; `onComplete` invoked eagerly at schedule-time) | same shape | Fixed: `start: false` is honored; `onComplete` is passed as a callback reference and only runs when the job actually completes. `cron` bumped 2.x → 4.x alongside this fix. |
| Per-`Brick`/`Structure` pino-pretty transport (bug: one worker thread per instance) | Shared, lazily-created logger (`getSharedLogger()` in `logger.ts`) | Fixed: one process-wide transport (or none, in JSON/production/non-TTY mode) instead of N. |
| n/a | `brick.tools()` | New: exposes every registered `Program` as a `ToolDefinition`. |
| n/a | `brick.use(...toolsets)` | New: attaches external tool arrays (e.g. future MCP-sourced tools) to a Brick. |
| n/a | `brick.ask(prompt, options?)` | New: convenience wrapper running `this.ai.ask()` with `brick.tools()` + attached tools pre-wired in. |
| `Program` had no schema | `Program.input?` / `Program.output?` (Standard Schema) | New, optional: validated in `Brick.run()` when present; also used by `brick.tools()`. |
| `new Database({ service: 'memory' \| 'sql' })` (single class) | Split into interfaces: `KeyValueStore`, `ConversationMemory`, `VectorStore` (`database.ts`), with in-memory implementations (`MemoryKeyValueStore`, `MemoryConversationMemory`, `MemoryVectorStore`) shipped in core | SQL support moved to `@intellibrix/sql` (`SQLKeyValueStore implements KeyValueStore`, real in Phase 2; `PgVectorStore` lands in Phase 7). `brick.db` now defaults to a `MemoryKeyValueStore` instance rather than being `undefined`. |
| `Structure` had no shared state | `structure.state: KeyValueStore` | New: shared key-value state across a Structure's Bricks, in-memory by default. |
| n/a | `Part.trust?: 'trusted' \| 'untrusted'` (`messages.ts`) | New: content-provenance tagging for indirect-prompt-injection defense. Defaults to `'trusted'` when omitted; threaded through `loop.ts`'s tool dispatch into `ToolContext.trust`, letting `needsApproval` policies key off it. |
| n/a | `Checkpointer` / `InMemoryCheckpointer` (`checkpoint.ts`) | New: a durable-execution seam. `runAgentLoop({ checkpointer?, resume? })` saves/loads run state; not a workflow engine — a production `Checkpointer` (Temporal/Inngest/etc.) is expected to be supplied by the application. |
| n/a | `intellibrix/testing` (`MockProvider`, `mockTool`) | New subpackage export: a scripted `Provider` for deterministic, network-free tests. |
| Bundled `src/bricks/{express,terminal,i18n}.ts` | Standalone `@intellibrix/{express,terminal,i18n}` packages | Import-path change only for Express/Terminal; I18n additionally fixes a global-singleton bug (see below). |
| `I18nBrick` used the global `i18next.init()` singleton (bug: multiple instances clobbered each other's language state) | `i18next.createInstance()` per `I18nBrick` | Behavior change, fixed in Phase 8. |
| n/a | `@intellibrix/mcp`, `@intellibrix/workspace`, `@intellibrix/github`, `@intellibrix/cli`, `@intellibrix/ai-sdk`, `@intellibrix/sandbox`, `@intellibrix/memory-sqlite` | Net-new packages with no 0.x equivalent, landing in Phases 3/6/7/8/9. |
| n/a | `@intellibrix/ai-sdk`: `provider('anthropic:claude-sonnet-5')` | New (Phase 3): resolves an intellibrix `Provider` from a `"<vendor>:<model>"` string via AI SDK's `createProviderRegistry`, lazily requiring whichever `@ai-sdk/{anthropic,openai,google}` adapter is installed (all optional peers) and throwing an actionable error naming the missing package otherwise. |
| n/a | `@intellibrix/ai-sdk`: `compatibleProvider(model, {baseURL, apiKey})` | New (Phase 3): resolves a `Provider` against any OpenAI-compatible HTTP endpoint (Ollama, OpenRouter, vLLM, ...) via the optional `@ai-sdk/openai-compatible` peer. |
| n/a | `@intellibrix/ai-sdk`: `aiSdkProvider(languageModel, opts?)` | New (Phase 3): wraps any AI SDK `LanguageModel` directly as an intellibrix `Provider`. `generate`/`stream` each perform exactly one model step (`stepCountIs(1)`); tools are declared schema-only (no `execute`), so AI SDK always returns control to `loop.ts` on a tool-call finish reason instead of looping internally. `opts.embeddingModel`/`opts.imageModel` enable `embed()`/`image()`. |
| n/a | `RunEvent` / `LoopOptions.onRunEvent` (`events.ts`) | New (Phase 4): structural observability events layered onto `LoopEvent` (additive — nothing consuming `LoopEvent`s breaks). Covers `run:start/finish`, `model:start/finish`, `tool:call/result/error`, `approval:requested/resolved`, emitted at the same call sites `loop.ts` already defines. `Intelligence`/`Brick.ask()` accept/forward `onRunEvent`; `AskOptions.brickName`/`LoopOptions.brickName` annotate `run:*` events. |
| n/a | `getTracer()` / `withSpan()` (`telemetry.ts`) | New (Phase 4): a structural `Span`/`Tracer` shape, never re-exported from `@opentelemetry/api` (so `tsc` never needs that package to typecheck core). `getTracer()` memoizes one guarded attempt to load the optional `@opentelemetry/api` peer, falling back permanently to a no-op tracer/span pair if it's absent. |
| n/a | `UsageAccumulator` / `defaultPriceTable` (`usage.ts`) | New (Phase 4): accumulates token usage and (via a `PriceTable`) cost across calls. `Intelligence.usage` is the per-instance accumulator; `Brick.usage` starts as a `.child()` of `this.ai.usage` (or standalone without one) and is rebound as a `.child()` of `Structure.usage` when added via `Structure.add()`, so totals roll up Brick → Structure. `AskResult` gained a `usage: Usage` field. |
| n/a | `recordProvider(inner, {onRecord})` / `replayProvider(fixtures)` (`record-replay.ts`) | New (Phase 4): `recordProvider` wraps any real `Provider`, reporting a serialized `{request, result}` per call (non-serializable fields like `abortSignal` stripped, tools reduced to name/description); persistence is the caller's job. `replayProvider` plays fixtures back in call order, throwing `replayProvider: fixtures exhausted` on drift rather than reusing stale data. |

## Notes

- Zod 4's built-in `StandardSchemaV1` conformance is the expected shape for `ToolDefinition.input`/`output` and `Program.input`/`output`; any Standard-Schema-conformant validator works, not just Zod.
- `Provider` implementations perform exactly one model step per `generate`/`stream` call — `intellibrix` owns iteration, tool dispatch, and approvals. This invariant is documented in `AGENTS.md` and should not be broken by any adapter (`@intellibrix/ai-sdk` or otherwise).
- `@intellibrix/ai-sdk` builds and typechecks with only `ai` installed and no vendor adapters present — `@ai-sdk/anthropic`/`@ai-sdk/openai`/`@ai-sdk/google`/`@ai-sdk/openai-compatible` are all optional peers, resolved lazily via a guarded `require()` (through `node:module`'s `createRequire`, since the package is ESM) inside `registry.ts`. Only calling `provider('<vendor>:...')` or `compatibleProvider()` for a vendor whose package isn't installed throws.
