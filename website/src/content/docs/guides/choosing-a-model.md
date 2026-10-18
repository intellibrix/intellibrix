---
title: Choosing a model
description: Use hosted vendors, OpenRouter, or local models, and handle models that write tool calls as text.
---

Pick a model with one line; the rest of your code does not change.

## Hosted vendors

```ts
import { provider } from '@intellibrix/ai-sdk'

provider('anthropic:claude-sonnet-5')
provider('openai:gpt-4.1')
provider('google:gemini-2.5-pro')
```

Install the matching `@ai-sdk/*` package (`@ai-sdk/anthropic`, `@ai-sdk/openai`,
`@ai-sdk/google`). They are optional peers, loaded lazily.

## OpenAI-compatible endpoints

OpenRouter, Ollama, vLLM, LM Studio and many gateways speak the OpenAI protocol. Use
`compatibleProvider` (needs `@ai-sdk/openai-compatible`):

```ts
import { compatibleProvider } from '@intellibrix/ai-sdk'

const openrouter = compatibleProvider('anthropic/claude-sonnet-5', {
  name: 'openrouter',
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: process.env.OPENROUTER_API_KEY,
})

const ollama = compatibleProvider('llama3.1', {
  name: 'ollama',
  baseURL: 'http://localhost:11434/v1',
  apiKey: 'ollama',
})
```

To wrap any other AI SDK language model, use `aiSdkProvider(languageModel)`.

## Models that write tool calls as text

Some open and free models do not use native tool calling. Instead they print the call in their
reply, for example:

```text
<|tool_call_start|>[read_file(path='a.txt')]<|tool_call_end|>
<tool_call>{"name": "read_file", "arguments": {"path": "a.txt"}}</tool_call>
```

Wrap the provider with `textToolCalls` and these become real tool calls that drive the loop:

```ts
import { Intelligence, textToolCalls } from 'intellibrix'

const intelligence = new Intelligence({
  provider: textToolCalls(openrouter),
  model: 'openrouter/free',
  tools,
})
```

- Native tool calls pass through untouched; only steps without any are rewritten.
- While streaming, markup is held back so users never see half a tool call.
- Approvals and schema validation still apply to rewritten calls.
- Pass `parsers` to add other formats, or `knownToolsOnly: true` to leave calls to unknown tools as plain text.

:::tip
Free and routing models (such as `openrouter/free`) may pick weak models that call tools badly.
For serious agent work, choose a model known for tool use.
:::
