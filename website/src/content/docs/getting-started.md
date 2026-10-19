---
title: Getting started
description: Install intellibrix and run your first agent in a few minutes.
---

intellibrix requires **Node 22 or newer**.

## Install

```sh
npm install intellibrix @intellibrix/ai-sdk zod @ai-sdk/anthropic
```

`@intellibrix/ai-sdk` connects intellibrix to model vendors through the
[AI SDK](https://ai-sdk.dev). The vendor package (`@ai-sdk/anthropic`, `@ai-sdk/openai`,
`@ai-sdk/google`, …) is an optional peer; install the one you use. To scaffold a whole project
instead, run `npx @intellibrix/cli init my-agent`.

## Your first brick

```ts
import { provider } from '@intellibrix/ai-sdk'
import { Brick, Intelligence, defineTool } from 'intellibrix'
import { z } from 'zod'

const brick = new Brick({
  name: 'assistant',
  intelligence: new Intelligence({
    provider: provider('anthropic:claude-sonnet-5'),
    model: 'claude-sonnet-5',
    system: 'You are a concise assistant.',
  }),
})

brick.use([
  defineTool({
    name: 'get_time',
    description: 'Get the current time as an ISO string',
    input: z.object({}),
    execute: async () => new Date().toISOString(),
  }),
])

const { text } = await brick.ask('What time is it?')
console.log(text)
```

Set `ANTHROPIC_API_KEY` and run it with `npx tsx first.ts`. The model sees the `get_time`
tool, calls it, and answers from the result. The loop that does this (call the model, run the
tools it asks for, feed results back) is `runAgentLoop`; you never write it yourself.

## Run it without an API key

Every example in these docs can be exercised offline with a scripted model. This is also how you
will test your own agents (see [Testing agents](/guides/testing/)):

```ts
import { Brick, Intelligence } from 'intellibrix'
import { MockProvider } from 'intellibrix/testing'

const brick = new Brick({
  name: 'assistant',
  intelligence: new Intelligence({
    provider: new MockProvider([{ text: 'Hello from a mock model.' }]),
    model: 'mock',
  }),
})

console.log((await brick.ask('Hi')).text)
```

## Next steps

- [Core concepts](/concepts/): bricks, programs, intelligence, structures.
- [Tools and Programs](/guides/tools-and-programs/): give your agent abilities.
- [Approvals and trust](/guides/approvals-and-trust/): keep humans in control.
- [Coding agents](/guides/coding-agents/): files, shell and git, behind approvals.
- [Storage and memory](/guides/storage-and-memory/) and [Observability](/guides/observability/): persist and watch your agents.
- The [examples](https://github.com/intellibrix/intellibrix/tree/master/examples) directory has runnable agents, including a terminal coding agent.
