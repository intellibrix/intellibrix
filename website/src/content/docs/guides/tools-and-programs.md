---
title: Tools and Programs
description: Give an agent abilities with typed tools, and package workflows as Programs.
---

## Tools

A tool is a typed function the model may call. Define one with `defineTool`:

```ts
import { defineTool } from 'intellibrix'
import { z } from 'zod'

export const lookupOrder = defineTool({
  name: 'lookup_order',
  description: 'Find an order by its id',
  input: z.object({ id: z.string() }),
  execute: async ({ id }) => ({ id, status: 'shipped' }),
})
```

- `input` is any [Standard Schema](https://standardschema.dev) (Zod 4 is what the docs use). The
  model's arguments are validated against it before `execute` runs, and the schema is sent to
  the model as JSON Schema.
- `execute` receives the typed input and a context (`signal`, `runId`, `trust`, `brick`).
- Attach tools to a brick with `brick.use([...])`, to an `Intelligence` with its `tools`
  option, or to a single call with `ask(prompt, { tools })`.

Two optional fields matter for safety (see [Approvals and trust](/guides/approvals-and-trust/)):

- `needsApproval`: `true`, or a function of the input and context, to require a decision
  before the tool runs.
- `resultTrust: 'untrusted'`: stamp the tool's result as coming from outside, if it returns
  fetched or user-controlled content.

## Programs

A **Program** is a named workflow on a brick: validated input, then steps made of actions.
Every program is automatically exposed to models as a tool, so one brick's programs can be
another agent's tools.

```ts
import { Brick } from 'intellibrix'
import { z } from 'zod'

const words = new Brick({ name: 'words' })

words.program({
  name: 'word_count',
  description: 'Count the words in a piece of text.',
  input: z.object({ text: z.string() }),
  steps: [
    {
      actions: [
        {
          method: async ({ text }: { text: string }) => ({
            words: text.split(/\s+/).filter(Boolean).length,
          }),
        },
      ],
    },
  ],
})

console.log(await words.run('word_count', { text: 'one two three' })) // { words: 3 }
```

Programs can call a brick's model too (`this.ai.ask(...)`); the
[`qa` example](https://github.com/intellibrix/intellibrix/tree/master/examples/qa) does exactly that.
Serve a program over MCP with [`intellibrix mcp serve`](/guides/mcp/).

## Subclassing

When a brick has real behaviour, extend `Brick` and register programs in the constructor, as
the `qa` example does. Keep the class focused on one capability so it can be reused in a
`Structure`.
