---
title: Testing agents
description: Deterministic, offline tests with MockProvider, mock tools and record/replay.
---

Agents are easy to test when the model is just a `Provider`. `intellibrix/testing` ships what you
need, so tests run offline with no API keys and no flakiness.

## Script the model with MockProvider

`MockProvider` takes a list of steps. Each model call consumes the next one: either a text reply
or a set of tool calls. Running past the end of the script throws, which catches agents that call
the model more often than you expected.

```ts
import { Intelligence, defineTool } from 'intellibrix'
import { MockProvider } from 'intellibrix/testing'
import { expect, it } from 'vitest'
import { z } from 'zod'

it('looks up the order, then answers', async () => {
  const lookups: string[] = []
  const lookup = defineTool({
    name: 'lookup_order',
    description: 'Find an order',
    input: z.object({ id: z.string() }),
    execute: async ({ id }) => {
      lookups.push(id)
      return { status: 'shipped' }
    },
  })

  const intelligence = new Intelligence({
    provider: new MockProvider([
      { toolCalls: [{ toolName: 'lookup_order', input: { id: '42' } }] },
      { text: 'Order 42 has shipped.' },
    ]),
    model: 'mock',
    tools: [lookup],
  })

  const result = await intelligence.ask('Where is order 42?')

  expect(lookups).toEqual(['42'])
  expect(result.text).toBe('Order 42 has shipped.')
  expect(result.steps).toBe(2)
})
```

The real tool, its schema validation and the loop all run; only the model is scripted.

## Test approval policies

Approvals are just a function, so they are straightforward to test. Script a model that tries a
gated tool and assert on what your policy did. See [Approvals and trust](/guides/approvals-and-trust/).

## Record real runs, replay them in CI

`recordProvider(provider)` wraps a real provider and captures each step. Save the fixtures, then
feed them to `replayProvider(fixtures)` in tests. You get realistic model behaviour, captured
once, replayed deterministically forever.

## Test your own stores

If you implement `KeyValueStore`, `ConversationMemory` or `VectorStore`, the conformance suites
(`keyValueStoreContract`, `conversationMemoryContract`, `vectorStoreContract`) return a list of
named cases to run against your implementation:

```ts
import { keyValueStoreContract } from 'intellibrix/testing'
import { describe, it } from 'vitest'

describe('MyStore', () => {
  for (const c of keyValueStoreContract(() => new MyStore())) it(c.name, c.run)
})
```

## Tips

- Prefer asserting on tool calls and final state over exact model text.
- Give every `MockProvider` the exact number of steps the scenario needs.
- Use a real model only in a small, separate, opt-in suite.
