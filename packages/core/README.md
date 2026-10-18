# intellibrix

The core of intellibrix: Brick, Structure, Intelligence, the agent loop, tools, events, approvals, memory interfaces and testing utilities.

Part of [intellibrix](https://github.com/intellibrix/intellibrix), a model-agnostic TypeScript framework for building agents and AI-powered software components. Requires Node 22+.

## Install

```sh
npm install intellibrix
```

## Usage

```typescript
import { Brick, Intelligence, defineTool } from 'intellibrix'
import { MockProvider } from 'intellibrix/testing'
```

`MockProvider` (from `intellibrix/testing`) lets you test agents with scripted model responses and no network. See the [root README](https://github.com/intellibrix/intellibrix#readme) for a full tour.

## Links

- [Documentation](https://github.com/intellibrix/intellibrix#readme)
- [Migration guide (0.x to 1.0)](https://github.com/intellibrix/intellibrix/blob/master/MIGRATION.md)
- [Issues](https://github.com/intellibrix/intellibrix/issues)

## License

MIT
