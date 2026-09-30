import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import {
  Brick,
  defineTool,
  runAgentLoop,
  Structure,
  type ToolContext,
  textMessage,
  toolToJSONSchema,
} from 'intellibrix'
import { MockProvider } from 'intellibrix/testing'
import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  type McpServerHandle,
  type McpToolContext,
  type McpToolsHandle,
  type McpToolsOptions,
  mcpTools,
  samplingFromProvider,
  serveMcp,
  textOf,
} from '../src/index.js'

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((fn) => fn()))
})

function makeBrick(name = 'calc') {
  const brick = new Brick({ name })
  brick.program({
    name: 'add',
    description: 'Adds two numbers',
    input: z.object({ a: z.number(), b: z.number() }),
    steps: [{ actions: [{ method: async (p: { a: number; b: number }) => p.a + p.b }] }],
  })
  return brick
}

async function connect(
  target: Brick | Structure,
  client: Pick<McpToolsOptions, 'onSamplingRequest' | 'onElicitation' | 'needsApproval'> = {},
  server: Partial<Parameters<typeof serveMcp>[1]> = {},
) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const served: McpServerHandle = await serveMcp(target, { transport: serverTransport, ...server })
  const mounted: McpToolsHandle = await mcpTools({ transport: clientTransport, ...client })
  cleanup.push(mounted.close, served.close)
  return { served, mounted }
}

const ctx: ToolContext = { runId: 'r' }

describe('mcp round trip', () => {
  it('runs a real brick Program through MCP end to end', async () => {
    const { mounted } = await connect(makeBrick())
    const add = mounted.tools.find((tool) => tool.name === 'add')

    expect(add?.description).toBe('Adds two numbers')
    expect(toolToJSONSchema(add as never)).toMatchObject({
      type: 'object',
      properties: { a: { type: 'number' }, b: { type: 'number' } },
    })
    expect(await add?.execute({ a: 1, b: 2 }, ctx)).toBe('3')
    await expect(add?.execute({ a: 'x' }, ctx)).rejects.toThrow()
  })

  it('tags MCP-sourced results untrusted when run through the agent loop', async () => {
    const { mounted } = await connect(makeBrick())

    const result = await runAgentLoop({
      provider: new MockProvider([
        { toolCalls: [{ toolName: 'add', input: { a: 2, b: 2 } }] },
        { text: 'done' },
      ]),
      model: 'mock',
      messages: [textMessage('user', 'add')],
      tools: mounted.tools,
    })

    const toolMessage = result.messages.find((message) => message.role === 'tool')
    expect(toolMessage?.content[0]).toMatchObject({ output: '4', trust: 'untrusted' })
  })

  it('exposes tools attached with brick.use()', async () => {
    const brick = makeBrick()
    brick.use([
      defineTool({
        name: 'echo',
        description: 'Echoes',
        input: z.object({ text: z.string() }),
        execute: async ({ text }) => text,
      }),
    ])

    const { mounted } = await connect(brick)
    expect(mounted.tools.map((tool) => tool.name).sort()).toEqual(['add', 'echo'])
  })

  it('close() is idempotent', async () => {
    const { served, mounted } = await connect(makeBrick())
    await mounted.close()
    await mounted.close()
    await served.close()
    await served.close()
  })
})

describe('serveMcp on a Structure', () => {
  it('merges tools across bricks', async () => {
    const structure = new Structure({ name: 's' })
    structure.add(makeBrick('one'))
    const other = new Brick({ name: 'two' })
    other.use([
      defineTool({
        name: 'ping',
        description: 'Pings',
        input: z.object({}),
        execute: async () => 'pong',
      }),
    ])
    structure.add(other)

    const { mounted } = await connect(structure)
    expect(mounted.tools.map((tool) => tool.name).sort()).toEqual(['add', 'ping'])
  })

  it('throws at startup on duplicate tool names', async () => {
    const structure = new Structure({ name: 's' })
    structure.add(makeBrick('one'))
    structure.add(makeBrick('two'))

    const [, serverTransport] = InMemoryTransport.createLinkedPair()
    await expect(serveMcp(structure, { transport: serverTransport })).rejects.toThrow(
      'duplicate tool name "add"',
    )
  })
})

describe('approval gating', () => {
  const dangerous = () =>
    defineTool({
      name: 'wipe',
      description: 'Dangerous',
      input: z.object({}),
      needsApproval: true,
      execute: async () => 'wiped',
    })

  it('denies tools that need approval when no hook is configured', async () => {
    const brick = new Brick({ name: 'b' })
    brick.use([dangerous()])
    const { mounted } = await connect(brick)

    await expect(mounted.tools[0]?.execute({}, ctx)).rejects.toThrow('denied by approval policy')
  })

  it('runs them when onToolApproval approves', async () => {
    const brick = new Brick({ name: 'b' })
    brick.use([dangerous()])
    const seen: unknown[] = []
    const { mounted } = await connect(
      brick,
      {},
      {
        onToolApproval: (call) => {
          seen.push(call)
          return true
        },
      },
    )

    expect(await mounted.tools[0]?.execute({}, ctx)).toBe('wiped')
    expect(seen[0]).toMatchObject({ toolName: 'wipe', trust: 'untrusted' })
  })
})

describe('sampling', () => {
  const askClient = () => {
    const brick = new Brick({ name: 'b' })
    brick.use([
      defineTool({
        name: 'summarize',
        description: 'Asks the client LLM',
        input: z.object({ text: z.string() }),
        execute: async ({ text }, toolCtx) => {
          const { sample } = toolCtx as ToolContext & McpToolContext
          if (!sample) throw new Error('not running behind MCP')
          const result = await sample({ messages: [textMessage('user', text)] })
          return textOf(result.message)
        },
      }),
    ])
    return brick
  }

  it("routes a server tool's sample() to the client's onSamplingRequest", async () => {
    const { mounted } = await connect(askClient(), {
      onSamplingRequest: samplingFromProvider(
        new MockProvider([{ text: 'sampled answer' }]),
        'mock',
      ),
    })

    expect(await mounted.tools[0]?.execute({ text: 'hi' }, ctx)).toBe('sampled answer')
  })

  it('declines sampling by default when the client did not opt in', async () => {
    const { mounted } = await connect(askClient())

    await expect(mounted.tools[0]?.execute({ text: 'hi' }, ctx)).rejects.toThrow(/sampling/i)
  })
})

describe('elicitation', () => {
  const askUser = () => {
    const brick = new Brick({ name: 'b' })
    brick.use([
      defineTool({
        name: 'greet',
        description: 'Asks the user for a name',
        input: z.object({}),
        execute: async (_input, toolCtx) => {
          const { elicit } = toolCtx as ToolContext & McpToolContext
          if (!elicit) throw new Error('not running behind MCP')
          const result = await elicit({
            message: 'Who?',
            schema: {
              type: 'object',
              properties: { name: { type: 'string' } },
              required: ['name'],
            },
          })
          return result.action === 'accept' ? `hello ${result.content.name}` : result.action
        },
      }),
    ])
    return brick
  }

  it("routes a server tool's elicit() to the client's onElicitation", async () => {
    const { mounted } = await connect(askUser(), {
      onElicitation: async () => ({ action: 'accept', content: { name: 'Ada' } }),
    })

    expect(await mounted.tools[0]?.execute({}, ctx)).toBe('hello Ada')
  })

  it("surfaces the user's decline to the tool", async () => {
    const { mounted } = await connect(askUser(), {
      onElicitation: async () => ({ action: 'decline' }),
    })

    expect(await mounted.tools[0]?.execute({}, ctx)).toBe('decline')
  })

  it('fails the call when the client did not opt in to elicitation', async () => {
    const { mounted } = await connect(askUser())

    await expect(mounted.tools[0]?.execute({}, ctx)).rejects.toThrow(/elicitation/i)
  })
})

describe('http transport', () => {
  it('serves and mounts over a real streamable HTTP session', async () => {
    const served = await serveMcp(makeBrick(), { transport: 'http', port: 0 })
    cleanup.push(served.close)
    expect(served.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/)

    const mounted = await mcpTools({ transport: 'http', url: served.url as string })
    cleanup.push(mounted.close)

    expect(await mounted.tools[0]?.execute({ a: 20, b: 22 }, ctx)).toBe('42')
  })
})
