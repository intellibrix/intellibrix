---
title: Command line and terminal
description: Scaffold a project, serve a Brick over MCP, and build interactive terminal agents.
---

## The `intellibrix` CLI

```bash
npx @intellibrix/cli init my-agent
```

`init <dir>` scaffolds a TypeScript project with a starter Brick, a `tsconfig.json` and an
`AGENTS.md` so coding agents understand the project. It refuses to write into a non-empty
directory unless you pass `--force`; `--name` sets the package name.

```bash
intellibrix mcp serve src/index.ts                  # stdio, for MCP clients
intellibrix mcp serve src/index.ts --transport http --port 10100 # streamable HTTP
```

`--host` and `--path` are also available for the HTTP transport.

`mcp serve <entry>` loads a TypeScript or JavaScript file in-process and serves its **default
export**, which must be a Brick or a Structure, as an MCP server. Its programs become tools. The
entry never needs a build step. See [MCP](/guides/mcp/) for client configuration and for how
approvals apply to served tools.

## Interactive agents with `TerminalBrick`

`@intellibrix/terminal` is a Brick with print and input helpers, and `chatRepl` runs a chat loop
on top of it:

```ts
import TerminalBrick, { chatRepl } from '@intellibrix/terminal'

const brick: TerminalBrick = new TerminalBrick({
  name: 'assistant',
  logLevel: 'fatal',
  intelligence: new Intelligence({
    provider,
    model,
    tools,
    onToolApproval: async (call) => {
      brick.print(`\nApprove ${call.toolName}? [y/N] `)
      return (await brick.input()).trim().toLowerCase() === 'y'
    },
  }),
})

await chatRepl(brick)
```

`chatRepl` reads a line, asks the model, and prints the reply. Typing `exit` or `quit`, or
pressing Ctrl-C at the prompt, ends the session; Ctrl-C while a reply is being generated cancels
just that turn. It also ends cleanly when input is closed, such as in a pipe or in CI. Pass
`threadId` to resume a conversation when the Intelligence has `memory`. Using the same terminal
for the approval prompt, as above, is the simplest way to put a human in the loop.

## Translating with `I18nBrick`

`@intellibrix/i18n` gives a Brick its own i18next instance, so two bricks never share language
state:

```ts
import I18nBrick from '@intellibrix/i18n'

const brick = new I18nBrick({
  resources: {
    en: { translation: { greeting: 'Hello' } },
    es: { translation: { greeting: 'Hola' } },
  },
})
brick.language = 'es'
brick.t('greeting') // 'Hola'
```
