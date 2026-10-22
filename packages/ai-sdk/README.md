# @intellibrix/ai-sdk

Provider adapter: `provider('vendor:model')`, `compatibleProvider` and `aiSdkProvider`, built on the Vercel AI SDK.

Part of [intellibrix](https://github.com/intellibrix/intellibrix), a model-agnostic TypeScript framework for building agents and AI-powered software components. Requires Node 22+.

## Install

```sh
npm install @intellibrix/ai-sdk intellibrix ai
```

## Usage

```typescript
import { provider } from '@intellibrix/ai-sdk'
import { Brick, Intelligence } from 'intellibrix'

const brick = new Brick({
  name: 'assistant',
  intelligence: new Intelligence({
    provider: provider('anthropic:claude-sonnet-5'),
    model: 'claude-sonnet-5'
  })
})
const { text } = await brick.ask('Hello!')
```

Install the `@ai-sdk/*` package for your vendor (e.g. `@ai-sdk/anthropic`). Any OpenAI-compatible endpoint (OpenRouter, Ollama, vLLM…) works through `compatibleProvider(model, { baseURL, apiKey, name })`, which needs the optional `@ai-sdk/openai-compatible` peer.

## Links

- [Documentation](https://github.com/intellibrix/intellibrix#readme)
- [Migration guide (0.x to 1.0)](https://github.com/intellibrix/intellibrix/blob/master/MIGRATION.md)
- [Issues](https://github.com/intellibrix/intellibrix/issues)

## License

MIT
