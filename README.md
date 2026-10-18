# 🧱 Intellibrix 🧱 <!-- omit in toc -->

## AI-Powered Software Component Framework <!-- omit in toc -->

> “Software and cathedrals are much the same; first we build them, then we pray.” --Sam Redwine

Made with ❤️ by [Jay Mathis](https://github.com/mathiscode)

[![NPM](https://nodei.co/npm/intellibrix.png?downloads=true&downloadRank=true&stars=true)](https://www.npmjs.com/package/intellibrix)

[![View Docs](https://img.shields.io/badge/view-docs-blue?style=for-the-badge)](https://intellibrix.dev)
[![Made with TypeScript](https://img.shields.io/badge/made_with-typescript-blue?style=for-the-badge)](https://www.typescriptlang.org)

[![Version](https://img.shields.io/github/package-json/v/intellibrix/intellibrix?color=success)](https://www.npmjs.com/package/intellibrix)
[![CircleCI](https://img.shields.io/circleci/build/github/intellibrix/intellibrix/master)](https://app.circleci.com/pipelines/github/intellibrix/intellibrix)
[![Last Commit](https://img.shields.io/github/last-commit/intellibrix/intellibrix.svg)](https://github.com/intellibrix/intellibrix/commit/master)
[![Open issues](https://img.shields.io/github/issues/intellibrix/intellibrix.svg)](https://github.com/intellibrix/intellibrix/issues)
[![Closed issues](https://img.shields.io/github/issues-closed/intellibrix/intellibrix.svg)](https://github.com/intellibrix/intellibrix/issues?q=is%3Aissue+is%3Aclosed)

[![Sponsors](https://img.shields.io/github/sponsors/mathiscode?color=red)](https://github.com/sponsors/mathiscode)
[![Contributors](https://img.shields.io/github/contributors/intellibrix/intellibrix?color=yellow)](https://github.com/intellibrix/intellibrix/graphs/contributors)
[![GitHub license](https://img.shields.io/badge/license-MIT-blue)](https://github.com/intellibrix/intellibrix/blob/master/LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-blue.svg)](https://github.com/intellibrix/intellibrix/compare)

[![Followers](https://img.shields.io/github/followers/intellibrix?style=social)](https://github.com/intellibrix)
[![Watchers](https://img.shields.io/github/watchers/intellibrix/intellibrix?style=social)](https://github.com/intellibrix/intellibrix)
[![Stars](https://img.shields.io/github/stars/intellibrix/intellibrix?style=social)](https://github.com/intellibrix/intellibrix)

---

![Diagram](https://raw.githubusercontent.com/intellibrix/intellibrix/master/assets/intellibrix-diagram.svg)

---

Intellibrix is a model-agnostic, TypeScript-native framework for building AI-capable software out of composable components. It pairs a small structural model (`Structure` → `Brick` → `Program` → `Step` → `Action`) with a typed agent loop, tools, memory, multi-agent composition and MCP support, plus ready-made bricks for agentic software engineering.

> **1.0 is a clean-break rewrite.** Coming from 0.x? See [MIGRATION.md](./MIGRATION.md).

- [Why Intellibrix](#why-intellibrix)
- [Quick start](#quick-start)
- [Concepts](#concepts)
- [Features](#features)
- [Examples](#examples)
- [Packages](#packages)
- [Safety model](#safety-model)
- [Use-cases](#use-cases)
- [Development](#development)

---

## Why Intellibrix

- **No vendor lock-in.** Swap models by changing a string: `provider('anthropic:claude-sonnet-5')`, `provider('openai:gpt-4.1')`, or any OpenAI-compatible endpoint (Ollama, vLLM, OpenRouter).
- **Agent logic is ordinary, testable code.** Programs and tools are typed and schema-validated, and runs can be mocked or replayed deterministically with no network.
- **Guardrails are built in.** Destructive tools require approval by default, and content from outside your process is tagged untrusted.
- **A thin layer over standards:** the [AI SDK](https://ai-sdk.dev), [MCP](https://modelcontextprotocol.io), [Standard Schema](https://standardschema.dev) (Zod 4 and friends) and OpenTelemetry. You aren't betting on a proprietary runtime.

## Quick start

Requires Node 22+.

```sh
npm install intellibrix @intellibrix/ai-sdk zod @ai-sdk/anthropic
# or scaffold a project:
npx @intellibrix/cli init my-agent
```

```typescript
import { provider } from '@intellibrix/ai-sdk'
import { Brick, Intelligence, defineTool } from 'intellibrix'
import { z } from 'zod'

const brick = new Brick({
  name: 'assistant',
  intelligence: new Intelligence({
    provider: provider('anthropic:claude-sonnet-5'),
    model: 'claude-sonnet-5',
    system: 'You are a concise assistant.'
  })
})

brick.use([defineTool({
  name: 'get_time',
  description: 'Get the current time as an ISO string',
  input: z.object({}),
  execute: async () => new Date().toISOString()
})])

const { text } = await brick.ask('What time is it?')
console.log(text)
```

## Concepts

- A **`Brick`** is a software component that provides specific functionality.
- A **`Structure`** is a collection of Bricks that share state (`structure.state`) and usage accounting, and can coordinate.
- A **`Program`** is a named, optionally schema-typed workflow on a Brick. Every Program is automatically exposed to models as a tool (`brick.tools()`).
- A Program contains **`Steps`**, which contain **`Actions`**, executed in sequence to process and transform data.
- An **`Intelligence`** gives a Brick model access via a `Provider`. A Provider performs exactly one model step per call; `runAgentLoop` owns iteration, tool dispatch and approvals.
- **Tools** (`defineTool`) are typed functions a model may call. Attach them with `brick.use(...)`, or get everything with `brick.toolset()`.
- **Bricks and Structures** emit events, log via a shared Pino logger, and can run scheduled **Tasks**.

You aren't limited to these: extend a Brick and make it work however you want.

## Features

### Model-agnostic Intelligence

```typescript
const intelligence = new Intelligence({ provider: provider('openai:gpt-4.1'), model: 'gpt-4.1' })

await intelligence.ask('Summarize this', { threadId: 'chat-1' })   // → { text, messages, steps, usage }
await intelligence.object(z.object({ sentiment: z.enum(['pos', 'neg']) }), 'I love it') // validated output
for await (const event of intelligence.stream('Tell me a story')) { /* StreamEvents */ }
await intelligence.embed('some text')
await intelligence.image('a shiny red apple')                       // if the provider supports it
```

Vendor adapters (`@ai-sdk/anthropic`, `@ai-sdk/openai`, `@ai-sdk/google`, `@ai-sdk/openai-compatible`) are optional peers, loaded lazily. Use `compatibleProvider(model, { baseURL, apiKey })` for local or self-hosted models, or `aiSdkProvider(languageModel)` to wrap any AI SDK model.

### Models that write tool calls as text

Some open and free models print tool calls into their reply (`<|tool_call_start|>[read_file(path='a.txt')]<|tool_call_end|>`, or Hermes/Qwen-style `<tool_call>{...}</tool_call>`) instead of using native tool calling. Wrap the provider and they drive the agent loop like any other:

```typescript
import { textToolCalls } from 'intellibrix'

const intelligence = new Intelligence({
  provider: textToolCalls(compatibleProvider(model, { baseURL, apiKey })),
  model
})
```

Native tool calls pass through untouched, markup is held back while streaming, and approvals and schema validation still apply. Pass `parsers` to add other formats, or `knownToolsOnly` to ignore calls to tools you didn't offer.

### Typed tools and Programs

```typescript
brick.program({
  name: 'word_count',
  description: 'Count the words in a piece of text.',
  input: z.object({ text: z.string() }),
  steps: [{ actions: [{ method: async ({ text }) => ({ words: text.split(/\s+/).filter(Boolean).length }) }] }]
})

await brick.run('word_count', { text: 'hello brick world' }) // validated, run directly…
await brick.ask('How many words are in "hello brick world"?') // …or called by the model as a tool
```

### Multi-agent structures (`@intellibrix/structures`)

```typescript
import { supervisor, router, sequential, parallel, handoffTool, asTool } from '@intellibrix/structures'

const team = supervisor({ supervisor: leadIntelligence, bricks: [researcher, writer], maxDepth: 3 })
await team.ask('Write a briefing on Structures')
```

- `supervisor`: a lead model delegates to sub-bricks, each wrapped as a tool.
- `router`: one structured classification step, then dispatch to the matching brick.
- `sequential` / `parallel`: pipelines and fan-out.
- `handoffTool`: transfer control between bricks.
- `structure:hop` events let you reconstruct the full call graph of a run.

### MCP, both directions (`@intellibrix/mcp`)

```typescript
import { mcpTools, serveMcp } from '@intellibrix/mcp'

// Mount a remote server's tools into a Brick…
const { tools, close } = await mcpTools({ transport: 'stdio', command: 'npx', args: ['some-mcp-server'] })
brick.use(tools)

// …or expose your Brick/Structure to Claude Desktop, Cursor, etc.
await serveMcp(brick, { transport: 'stdio' })
```

Sampling and elicitation are supported. Or from the CLI: `intellibrix mcp serve ./src/brick.ts`.

### Memory and storage

- Interfaces: `KeyValueStore`, `ConversationMemory`, `VectorStore`, with in-memory implementations in core.
- `@intellibrix/memory-sqlite`: zero-dependency `node:sqlite` conversation memory and vector store.
- `@intellibrix/sql`: SQL key-value store (Sequelize) and Postgres + pgvector `PgVectorStore` (HNSW).
- Conformance suites (`intellibrix/testing`) validate your own store implementations.

```typescript
import { SQLiteConversationMemory } from '@intellibrix/memory-sqlite'

const intelligence = new Intelligence({
  provider, model,
  memory: new SQLiteConversationMemory({ path: './chat.db' })
})
await intelligence.ask('My name is Ada', { threadId: 'ada' })
await intelligence.ask('What is my name?', { threadId: 'ada' }) // remembers
```

### Observability and testing

- `onRunEvent` emits `run:*`, `model:*`, `tool:*` and `approval:*` events.
- Optional OpenTelemetry spans (`@opentelemetry/api` is an optional peer).
- Token and cost accounting that rolls up Brick → Structure (`brick.usage`).
- `Checkpointer` seam for durable execution, with `recordProvider` / `replayProvider` for deterministic fixtures.
- `intellibrix/testing` provides `MockProvider` and `mockTool` for offline tests.

### Events, logging and tasks

```typescript
structure.events.on('add', ({ brick }) => console.log(`Added ${brick.id}`))

const structure = new Structure({ name: 'My Structure', logLevel: 'debug' }) // Pino, one shared transport

brick.schedule({
  name: 'Nightly',
  schedule: '0 0 * * *', // cron syntax or a Date
  start: true,
  method: () => console.log('Running nightly job')
})
brick.unschedule('Nightly')
```

Set `INTELLIBRIX_LOG_STDERR` to log JSON to stderr (required for stdio MCP servers).

## Examples

Runnable examples live in [`examples/`](./examples):

| Example | Shows |
|---|---|
| `coding-agent` | A terminal coding agent with jailed workspace tools and human approvals, backed by OpenRouter (`OPENROUTER_API_KEY`) |
| `supervisor` | Multi-agent delegation, running offline with `MockProvider` |
| `qa` | A custom `Brick` subclass with a Program |
| `mcp-server` | A Brick served over MCP |

```typescript
// A coding agent with human-in-the-loop approvals
const brick = new TerminalBrick({
  intelligence: new Intelligence({
    provider: compatibleProvider('openrouter/free', {
      baseURL: 'https://openrouter.ai/api/v1',
      apiKey: process.env.OPENROUTER_API_KEY
    }),
    model: 'openrouter/free',
    tools: workspaceTools({ root, shell: { allow: ['node', 'pnpm', 'git'] } }),
    onToolApproval: async (call) => {
      brick.print(`Approve ${call.toolName}(${JSON.stringify(call.input)})? [y/N] `)
      return (await brick.input()).trim().toLowerCase() === 'y'
    }
  })
})
await chatRepl(brick)
```

## Packages

| Package | Purpose |
|---|---|
| `intellibrix` | Core: Brick, Structure, Intelligence, agent loop, tools, events, approvals, memory interfaces, testing utilities |
| `@intellibrix/ai-sdk` | Provider adapter: `provider('vendor:model')`, `compatibleProvider`, `aiSdkProvider` |
| `@intellibrix/structures` | Multi-agent composition: supervisor, router, pipelines, handoffs |
| `@intellibrix/mcp` | MCP client (mount remote tools) and server (expose Bricks) |
| `@intellibrix/memory-sqlite` | `node:sqlite` conversation memory and vector store |
| `@intellibrix/sql` | SQL key-value store and pgvector `VectorStore` |
| `@intellibrix/workspace` | Jailed filesystem tools, allowlisted shell, git tools |
| `@intellibrix/sandbox` | Hosted code execution (E2B, Daytona, Cloudflare) |
| `@intellibrix/github` | Issue, PR and review tools; HMAC-verified webhook bridge |
| `@intellibrix/express` | Express brick with `/ask` and SSE streaming routes |
| `@intellibrix/terminal` | TerminalKit brick and `chatRepl` |
| `@intellibrix/i18n` | i18next-powered internationalization brick |
| `@intellibrix/cli` | `intellibrix init` and `intellibrix mcp serve` |

You can also publish your own Bricks. To have one under the `@intellibrix` scope, contact `dev@intellibrix.dev`.

## Safety model

- **Approvals.** `needsApproval` gates shell, file writes, git commits and sandboxed code execution by default. Supply `onToolApproval` to decide, and a call can be approved, denied or edited. Tools behind `serveMcp` are denied unless you provide `onToolApproval`.
- **Untrusted content.** Every message `Part` may carry `trust: 'trusted' | 'untrusted'`. Workspace reads, GitHub data and MCP results are tagged `untrusted`, so approval policies can key off provenance to defend against indirect prompt injection.
- **Jailed workspace.** File tools are confined to a root and re-checked after `realpath`, so symlinks can't escape.

See the [threat model](THREAT_MODEL.md) for what each defense covers and its limits, and [SECURITY.md](SECURITY.md) to report a vulnerability.

## Use-cases

- **Coding and repo agents:** PR-review bots and issue triage driven by webhooks.
- **Multi-agent assistants:** a supervisor with specialist bricks, or a router in front of a Q&A bot.
- **MCP servers:** expose your capabilities to Claude Desktop, Cursor and other clients.
- **Chat and AI backends:** Express with streaming, persistent thread memory and RAG over pgvector or SQLite.
- **Scheduled automation:** cron tasks combined with LLM steps.
- **Local-first tools:** Ollama plus `node:sqlite` with no external services.

---

## Development

This is a pnpm monorepo (Node 22+). See [AGENTS.md](./AGENTS.md) for the contributor guide.

```sh
git clone https://github.com/intellibrix/intellibrix.git # or your fork
cd intellibrix
pnpm install
pnpm -r typecheck
pnpm biome ci .
pnpm -r test
pnpm -r build
pnpm docs   # typedoc site + llms.txt
```

Tests run offline using `MockProvider`; no API keys are needed.

## License

MIT
