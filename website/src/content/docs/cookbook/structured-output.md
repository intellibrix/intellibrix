---
title: Structured output
description: Get validated, typed data back from a model.
---

`intelligence.object` asks for output matching a schema and validates it before returning:

```ts
import { z } from 'zod'

const Sentiment = z.object({
  sentiment: z.enum(['positive', 'negative', 'neutral']),
  confidence: z.number().min(0).max(1),
})

const result = await intelligence.object(Sentiment, 'I absolutely love this library')
// result is typed as { sentiment: 'positive' | ...; confidence: number }
```

Because the result is validated against your schema, you can pass it straight into the rest of
your program. If the model's output does not match the schema, `object` throws instead of
returning bad data.

Under the hood this forces a synthetic tool call matching your schema, which avoids per-vendor
JSON-mode differences. The consequence is that **the model must support tool calling**. For a
model that writes tool calls as text, wrap its provider with
[`textToolCalls`](/guides/choosing-a-model/).

## Routing

`router` from `@intellibrix/structures` does exactly this: one structured classification step,
then dispatch to the matching brick. Use it to pick a path from a model's classification.
