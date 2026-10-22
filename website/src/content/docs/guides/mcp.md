---
title: MCP, both directions
description: Mount tools from MCP servers, and expose your bricks to MCP clients.
---

The [Model Context Protocol](https://modelcontextprotocol.io) connects agents to tools. intellibrix
speaks it as a client and as a server, from `@intellibrix/mcp`.

## Use a remote server's tools

```ts
import { mcpTools } from '@intellibrix/mcp'

const { tools, close } = await mcpTools({
  transport: 'stdio',
  command: 'npx',
  args: ['some-mcp-server'],
})

brick.use(tools)
// …later
await close()
```

Results from remote servers are tagged `untrusted`, so your [approval policy](/guides/approvals-and-trust/)
can treat them with suspicion.

## Serve a brick to Claude Desktop, Cursor and others

Every Program on a brick becomes an MCP tool.

```ts
import { serveMcp } from '@intellibrix/mcp'

await serveMcp(brick, { transport: 'stdio' })
```

Or use the CLI on a module whose default export is a brick:

```sh
npx @intellibrix/cli mcp serve ./src/brick.ts
```

Register it with a client, for example with Claude Code:
`claude mcp add words -- npx @intellibrix/cli mcp serve ./src/brick.ts`.

- **Logs go to stderr.** On stdio transports stdout carries the protocol, so intellibrix keeps
  logging off it. Set `INTELLIBRIX_LOG_STDERR` to log JSON to stderr from your own code.
- **Gated tools are denied** unless you pass `onToolApproval` to `serveMcp`. Input from a remote
  caller is untrusted by definition.
- Sampling and elicitation are supported, so a server can ask the client's model for completions
  or ask the user for input.

See the [`mcp-server` example](https://github.com/intellibrix/intellibrix/tree/master/examples/mcp-server).
