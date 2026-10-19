---
title: Observability and durability
description: Watch runs as they happen, track tokens and cost, record and replay model calls, and resume interrupted runs.
---

## Events

Every run emits two streams of events. Both are optional callbacks on `Intelligence` (as a
default) or on a single `ask`.

`onEvent` carries the loop's own `LoopEvent`s: `step-start`, `step-finish`, `tool-call-start`,
`tool-call-approval-required`, `tool-call-denied`, `tool-call-finish`, `loop-finish` and `error`.

`onRunEvent` carries structural `RunEvent`s, which are the better fit for logging and tracing:

| Event | Fields (besides `runId`) |
|---|---|
| `run:start`, `run:finish` | `brickName`, `steps` (finish) |
| `model:start`, `model:finish` | `stepIndex`, `model`, `durationMs` (finish) |
| `tool:call` | `toolCallId`, `toolName`, `input` |
| `tool:result` | `toolCallId`, `toolName`, `output`, `durationMs` |
| `tool:error` | `toolCallId`, `toolName`, `error` |
| `approval:requested`, `approval:resolved` | `toolName`, `input`, `trust`, `decision` |

```ts
const intelligence = new Intelligence({
  provider,
  model,
  onRunEvent: (e) => {
    if (e.type === 'tool:result') console.log(`${e.toolName} took ${e.durationMs}ms`)
    if (e.type === 'approval:resolved') audit.write({ tool: e.toolName, decision: e.decision })
  },
})
```

Bricks and Structures also have an `events` emitter for application events such as
[webhooks](/guides/github/).

## Tokens and cost

Every `Intelligence`, `Brick` and `Structure` has a `usage` accumulator. A Brick's usage rolls up
into its Structure's, so you get per-agent and grand totals.

```ts
await intelligence.ask('Summarize the report')
intelligence.usage.totals
// { inputTokens, outputTokens, totalTokens, cost }
```

`cost` comes from a price table keyed by `"provider:model"`. `defaultPriceTable` is a starting
point that goes stale, so pass your own with the `priceTable` option. If a model is missing from
the table, `cost` is `undefined` rather than a wrong number.

## Tracing

intellibrix does not create spans on its own. It gives you a tiny tracer that uses
`@opentelemetry/api` if you have it installed and does nothing otherwise, and run events to
drive it:

```ts
import { getTracer } from 'intellibrix'

const tracer = getTracer('my-app')
const spans = new Map<string, ReturnType<typeof tracer.startSpan>>()

const onRunEvent = (e: RunEvent) => {
  if (e.type === 'tool:call') spans.set(e.toolCallId, tracer.startSpan(`tool ${e.toolName}`))
  if (e.type === 'tool:result' || e.type === 'tool:error') {
    spans.get(e.toolCallId)?.end()
    spans.delete(e.toolCallId)
  }
}
```

## Record and replay

Record real model calls once, then replay them in tests with no network and no cost.

```ts
import { recordProvider, replayProvider, type RecordedStep } from 'intellibrix'

// 1. Record against the real provider
const steps: RecordedStep[] = []
const recording = recordProvider(realProvider, { onRecord: (s) => void steps.push(s) })
await new Intelligence({ provider: recording, model, tools }).ask('Fix the bug')
await writeFile('fixtures/fix-bug.json', JSON.stringify(steps))

// 2. Replay in a test
const fixtures = JSON.parse(await readFile('fixtures/fix-bug.json', 'utf8'))
await new Intelligence({ provider: replayProvider(fixtures), model, tools }).ask('Fix the bug')
```

Fixtures hold the request (tools reduced to name and description) and the model's answer. Replay
returns them in order and throws `fixtures exhausted` if your code makes more calls than were
recorded, so drift fails loudly. Recorded prompts can contain secrets, so review fixtures before
you commit them. For hand-written scripts see [Testing agents](/guides/testing/).

## Checkpoints and resuming

The loop saves its state to a `Checkpointer` before each step and after each batch of tool
results. By default that is `InMemoryCheckpointer`, which does not survive a restart. To resume
after a crash, give the Intelligence a durable one and pass the same `runId`:

```ts
import type { Checkpointer, CheckpointState } from 'intellibrix'

class FileCheckpointer implements Checkpointer {
  async save(runId: string, state: CheckpointState) {
    await writeFile(`./runs/${runId}.json`, JSON.stringify(state))
  }
  async load(runId: string) {
    try {
      return JSON.parse(await readFile(`./runs/${runId}.json`, 'utf8')) as CheckpointState
    } catch {
      return undefined
    }
  }
}
```

Then call `runAgentLoop({ ..., runId, checkpointer, resume: true })`. The run restarts from the
saved messages and step. A step interrupted midway runs again, so a tool with side effects can
run twice. Make such tools idempotent. This is a deliberately small seam, not a workflow engine:
back it with Temporal, Inngest or a database if you need retries and exactly-once semantics.
