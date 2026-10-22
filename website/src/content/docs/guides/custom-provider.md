---
title: Writing a custom provider
description: Connect any model or service by implementing the Provider interface.
---

A `Provider` does **exactly one model step** per call. The agent loop owns iteration, tool
dispatch, approvals and memory, so a provider is small.

```ts
interface Provider {
  id: string
  generate(req: GenerateRequest): Promise<StepResult>
  stream(req: GenerateRequest): AsyncIterable<StreamEvent>
  embed?(input: string[], opts?): Promise<number[][]>
  image?(prompt: string, opts?): Promise<{ url?: string; data?: string }>
}
```

## The quick way

For a model that just maps a prompt to text, `customProvider` wraps a single function:

```ts
import { Intelligence, customProvider } from 'intellibrix'

const intelligence = new Intelligence({
  provider: customProvider(async (prompt) => `You said: ${prompt}`),
  model: 'echo',
})
```

This provider has no tool calling, which is fine for plain generation.

## A full provider

`generate` receives the model name, system prompt, messages and the tools on offer, and returns
the assistant `message`, a `finishReason`, and optionally `usage`. `stream` yields `text-delta`
and `tool-call` events and ends with a `finish` event carrying the same `StepResult`.

```ts
import { randomUUID } from 'node:crypto'
import type { GenerateRequest, Provider, StepResult, StreamEvent } from 'intellibrix'

export function myProvider(endpoint: string): Provider {
  async function generate(req: GenerateRequest): Promise<StepResult> {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: req.model, system: req.system, messages: req.messages }),
      signal: req.abortSignal,
    })
    if (!res.ok) throw new Error(`model request failed: ${res.status}`)
    const data = (await res.json()) as { text: string }
    return {
      message: { role: 'assistant', content: [{ type: 'text', text: data.text }] },
      finishReason: 'stop',
    }
  }

  return {
    id: 'my-provider',
    generate,
    async *stream(req): AsyncIterable<StreamEvent> {
      const result = await generate(req)
      for (const part of result.message.content) {
        if (part.type === 'text') yield { type: 'text-delta', text: part.text }
        if (part.type === 'tool-call') {
          yield { type: 'tool-call', toolCallId: part.toolCallId ?? randomUUID(), toolName: part.toolName, input: part.input }
        }
      }
      yield { type: 'finish', result }
    },
  }
}
```

To support tools, translate `req.tools` into your service's format and map its tool-call
response into `tool-call` parts (`toolCallId`, `toolName`, `input`) with
`finishReason: 'tool-calls'`. If your model prints calls as text instead, wrap it with
[`textToolCalls`](/guides/choosing-a-model/).

## Always honour the abort signal

Pass `req.abortSignal` to your HTTP client. It is how Ctrl+C in a terminal REPL, request
cancellation and run timeouts stop an in-flight model call.

## Test it

Use `MockProvider` as a reference for the expected shape, and run your provider through a few
[tests with scripted tool calls](/guides/testing/).
