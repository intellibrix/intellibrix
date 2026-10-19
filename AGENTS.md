# AGENTS.md

Agent-facing guide to the intellibrix monorepo. This file is the canonical source; `CLAUDE.md` just points here.

## What this is

intellibrix is a model-agnostic, TypeScript-native, agent-native framework built around `Structure` → `Brick` → `Program` → `Step` → `Action`, plus a typed `Intelligence`/`Provider`/agent-loop stack, MCP client+server, multi-agent Structures, and bricks aimed at agentic software engineering. It is a pnpm monorepo.

## Repo layout

| Package | Purpose |
|---|---|
| `packages/core` (`intellibrix`) | Brick, Structure, Intelligence, Provider interface, tools, agent loop, events/telemetry, approvals, KV/memory/vector interfaces |
| `packages/ai-sdk` (`@intellibrix/ai-sdk`) | AI SDK adapter; `provider('anthropic:claude-sonnet-5')`-style resolution |
| `packages/mcp` (`@intellibrix/mcp`) | MCP client (mount remote tools) + server (expose Brick/Structure), including sampling + elicitation |
| `packages/sql` (`@intellibrix/sql`) | SQL-backed KeyValueStore (Sequelize) + pgvector VectorStore |
| `packages/memory-sqlite` (`@intellibrix/memory-sqlite`) | node:sqlite conversation memory + vector store |
| `packages/express`, `packages/terminal`, `packages/i18n` | Ported bundled bricks |
| `packages/workspace` (`@intellibrix/workspace`) | Jailed fs tools, shell (allowlist), git tools |
| `packages/agent-tools` (`@intellibrix/agent-tools`) | `apply_patch` (atomic unified diffs), `run_checks` (structured test/typecheck/lint results), `todo`, SSRF-safe `fetch_url`, `ask_user`, `delegate` |
| `packages/sandbox` (`@intellibrix/sandbox`) | Vendor-neutral code-execution tool: local Podman/Docker containers or hosted sandboxes |
| `packages/github` (`@intellibrix/github`) | octokit issue/PR/review tools + webhook bridge |
| `packages/cli` (`@intellibrix/cli`) | `intellibrix init`, `intellibrix mcp serve <entry>` |
| `examples/*` | Runnable tsx examples |
| `website` | Starlight docs site (guides, cookbook); `pnpm docs:site` builds it with the typedoc API reference under `/api/` |

## Build/test/lint commands

- `pnpm install` — install all workspace packages
- `pnpm -r typecheck` — typecheck every package
- `pnpm biome ci .` — lint/format check
- `pnpm -r build` — build every package (tsdown: ESM + CJS + dts)
- `pnpm -r test` — run every package's Vitest suite
- `pnpm --filter <pkg> test` — run one package's tests only
- `pnpm check:packages` — publint + attw against each packed package (needs a build)
- `pnpm check:api` — fail if the public API of `intellibrix` drifted from `packages/core/etc/*.api.md`; after an intentional change run `pnpm --filter intellibrix api:update` and commit the report (and update `MIGRATION.md` for breaking changes)
- `pnpm smoke:examples` — run every example offline and check its output (needs a build)
- `pnpm docs:site` — build the whole docs site (needs `pnpm -r build` first); `pnpm --filter intellibrix-website dev` serves it on port 10100
- `pnpm docs` — generate the multi-package typedoc site + llms.txt

## Core API surface is fixed

`packages/core/src/{messages,tool,provider,loop,intelligence,brick,structure,database,testing,checkpoint}.ts` define intellibrix's stable v1 surface. Do not change these signatures without updating `MIGRATION.md`. CI enforces this through the API reports in `packages/core/etc/`.

## Conventions

- Tool inputs are Zod 4 schemas (or raw JSON Schema via the `fromJSONSchema` adapter for MCP-sourced tools), always behind `StandardSchemaV1`.
- Define tools with `defineTool({name, description, input, execute, needsApproval?})`.
- A `Provider` does exactly one model step per call — `packages/core/src/loop.ts` owns iteration.
- `needsApproval` gates destructive/high-blast-radius tools by default (shell, file writes, git commits, sandboxed code execution).
- Every `Part` carries an optional `trust: 'trusted' | 'untrusted'` field; content fetched from outside the process (workspace reads, GitHub data, MCP tool results) is tagged `'untrusted'`.

## Where tests live

Each package's `test/*.test.ts`, run via Vitest.

## Common tasks

- Add a new brick package: scaffold under `packages/<name>`, add `dependencies: { intellibrix: "workspace:^" }`, run `pnpm install`.
- Add a new tool: `defineTool(...)` in the owning package, exported from its `index.ts`.
- Run a single test file: `pnpm --filter <pkg> vitest run <path>`.

## Things that will break silently

- Reintroducing a global `i18next.init()` singleton in `@intellibrix/i18n` — instances must use `i18next.createInstance()`.
- Skipping the `fs.realpath` re-check in `@intellibrix/workspace`'s `resolveJailed` — a symlink can otherwise escape the jail.
- Bypassing `needsApproval` for `shell`/`write_file`/`edit_file`/`apply_patch`/`run_checks`/`git_commit`/`run_code` tools.
- Weakening the connect-time address check in `fetch_url` (`packages/agent-tools/src/fetch.ts`): validating DNS before connecting, or following redirects without re-checking, reopens SSRF and DNS rebinding.
- Passing model-supplied code or arguments to the container CLI on the command line in `@intellibrix/sandbox` — code goes over stdin only.
