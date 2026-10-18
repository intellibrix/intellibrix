# @intellibrix/terminal

TerminalKit brick and `chatRepl` for intellibrix.

Part of [intellibrix](https://github.com/intellibrix/intellibrix), a model-agnostic TypeScript framework for building agents and AI-powered software components. Requires Node 22+.

## Install

```sh
npm install @intellibrix/terminal intellibrix terminal-kit
```

## Usage

```typescript
import TerminalBrick, { chatRepl } from '@intellibrix/terminal'

const brick = new TerminalBrick({ name: 'chat', intelligence })
await chatRepl(brick)
```

Type `exit` or press Ctrl+C to quit; Ctrl+C during a reply cancels just that turn.

## Links

- [Documentation](https://github.com/intellibrix/intellibrix#readme)
- [Migration guide (0.x to 1.0)](https://github.com/intellibrix/intellibrix/blob/master/MIGRATION.md)
- [Issues](https://github.com/intellibrix/intellibrix/issues)

## License

MIT
