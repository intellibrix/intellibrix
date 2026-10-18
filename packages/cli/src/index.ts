/**
 * @module CLI
 *
 * `intellibrix init <dir>` and `intellibrix mcp serve <entry>`.
 */
import path from 'node:path'
import { parseArgs } from 'node:util'
import { type McpServerHandle, serveMcp } from '@intellibrix/mcp'
import { init } from './init.js'

export * from './init.js'

const USAGE = `intellibrix <command>

  init <dir> [--force] [--name <pkg>]            scaffold a new project
  mcp serve <entry.ts> [--transport stdio|http]   serve a Brick/Structure over MCP
                       [--port <n>] [--host <h>] [--path <p>]
`

type Servable = Parameters<typeof serveMcp>[0]

function isServable(value: unknown): value is Servable {
  const v = value as { toolset?: unknown; bricks?: unknown } | null
  // Duck-typed: the entry may resolve its own copy of `intellibrix`, so `instanceof` is unreliable.
  return typeof v?.toolset === 'function' || (typeof v === 'object' && v !== null && 'bricks' in v)
}

/**
 * Loads a TypeScript (or JS) entry through tsx's programmatic API, in-process,
 * and returns its default export, which must be a Brick or Structure.
 */
export async function loadEntry(entry: string): Promise<Servable> {
  const file = path.resolve(entry)
  const { register } = await import('tsx/esm/api')
  const unregister = register()
  try {
    const mod = (await import(/* @vite-ignore */ new URL(`file://${file}`).href)) as {
      default?: unknown
    }
    if (!isServable(mod.default)) {
      throw new Error(
        `${entry} must default-export a Brick or Structure (got ${typeof mod.default}).`,
      )
    }
    return mod.default
  } finally {
    await unregister()
  }
}

/**
 * Runs the CLI. Returns the live server handle for `mcp serve` so the caller can
 * close it on shutdown; `undefined` for commands that finish on their own.
 */
export async function runCli(argv: string[]): Promise<McpServerHandle | undefined> {
  const [command, ...rest] = argv

  if (command === 'init') {
    const { values, positionals } = parseArgs({
      args: rest,
      allowPositionals: true,
      options: { force: { type: 'boolean' }, name: { type: 'string' } },
    })
    const files = await init(positionals[0] ?? '.', { force: values.force, name: values.name })
    process.stdout.write(`Created ${files.join(', ')}\nNext: pnpm install && pnpm start\n`)
    return undefined
  }

  if (command === 'mcp' && rest[0] === 'serve') {
    const { values, positionals } = parseArgs({
      args: rest.slice(1),
      allowPositionals: true,
      options: {
        transport: { type: 'string', default: 'stdio' },
        port: { type: 'string' },
        host: { type: 'string' },
        path: { type: 'string' },
      },
    })
    const entry = positionals[0]
    if (!entry) throw new Error('mcp serve needs an entry file.\n\n' + USAGE)
    if (values.transport !== 'stdio' && values.transport !== 'http') {
      throw new Error(`--transport must be "stdio" or "http" (got "${values.transport}")`)
    }

    // stdout carries the MCP protocol over stdio, so Brick logs must go to stderr.
    // Set before the entry is imported: the shared logger is created on first use.
    if (values.transport === 'stdio') process.env.INTELLIBRIX_LOG_STDERR = '1'

    const target = await loadEntry(entry)
    const handle = await serveMcp(target, {
      transport: values.transport,
      port: values.port === undefined ? undefined : Number(values.port),
      host: values.host,
      path: values.path,
    })
    if (handle.url) process.stderr.write(`MCP server listening at ${handle.url}\n`)
    return handle
  }

  process.stdout.write(USAGE)
  if (command && command !== '--help' && command !== '-h')
    throw new Error(`Unknown command: ${argv.join(' ')}`)
  return undefined
}
