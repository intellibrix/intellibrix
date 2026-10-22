# @intellibrix/mcp

MCP client and server for intellibrix: mount remote tools or expose your Bricks.

Part of [intellibrix](https://github.com/intellibrix/intellibrix), a model-agnostic TypeScript framework for building agents and AI-powered software components. Requires Node 22+.

## Install

```sh
npm install @intellibrix/mcp intellibrix
```

## Usage

```typescript
import { mcpTools, serveMcp } from '@intellibrix/mcp'

const { tools, close } = await mcpTools({ transport: 'stdio', command: 'npx', args: ['some-mcp-server'] })
brick.use(tools)

await serveMcp(brick, { transport: 'stdio' })
```

Sampling and elicitation are supported. Results from remote tools are tagged `untrusted`.

## Links

- [Documentation](https://github.com/intellibrix/intellibrix#readme)
- [Migration guide (0.x to 1.0)](https://github.com/intellibrix/intellibrix/blob/master/MIGRATION.md)
- [Issues](https://github.com/intellibrix/intellibrix/issues)

## License

MIT
