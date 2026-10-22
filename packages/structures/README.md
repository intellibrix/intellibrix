# @intellibrix/structures

Multi-agent composition for intellibrix: supervisor, router, sequential, parallel and handoffs.

Part of [intellibrix](https://github.com/intellibrix/intellibrix), a model-agnostic TypeScript framework for building agents and AI-powered software components. Requires Node 22+.

## Install

```sh
npm install @intellibrix/structures intellibrix
```

## Usage

```typescript
import { supervisor } from '@intellibrix/structures'

const team = supervisor({ supervisor: leadIntelligence, bricks: [researcher, writer], maxDepth: 3 })
await team.ask('Write a briefing on Structures')
```

Also exports `router`, `sequential`, `parallel`, `handoffTool` and `asTool`.

## Links

- [Documentation](https://github.com/intellibrix/intellibrix#readme)
- [Migration guide (0.x to 1.0)](https://github.com/intellibrix/intellibrix/blob/master/MIGRATION.md)
- [Issues](https://github.com/intellibrix/intellibrix/issues)

## License

MIT
