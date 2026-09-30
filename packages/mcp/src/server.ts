import { randomUUID } from 'node:crypto'
import {
  createServer as createHttpServer,
  type Server as HttpServer,
  type IncomingMessage,
} from 'node:http'
import type { AddressInfo } from 'node:net'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import {
  CallToolRequestSchema,
  isInitializeRequest,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import {
  type ApprovalHook,
  type Brick,
  resolveNeedsApproval,
  type Structure,
  type ToolContext,
  type ToolDefinition,
  toolToJSONSchema,
  validateToolInput,
} from 'intellibrix'
import {
  contentToParts,
  type ElicitationRequest,
  type McpToolContext,
  partsToContentBlocks,
  type SamplingRequest,
} from './sampling.js'

export type ServeMcpOptions = {
  transport: 'stdio' | 'http' | Transport
  /** HTTP only. `0` picks a free port. Default 3000. */
  port?: number
  /** HTTP only. Default `127.0.0.1` (loopback), avoiding DNS-rebinding exposure. */
  host?: string
  /** HTTP only. Default `/mcp`. */
  path?: string
  name?: string
  version?: string
  /**
   * Decides calls to tools that need approval. There is no agent loop between a
   * remote MCP caller and the tool, so without this hook such calls are denied.
   */
  onToolApproval?: ApprovalHook
}

export type McpServerHandle = {
  /** The HTTP endpoint URL, when serving over `'http'`. */
  url?: string
  /** Closes every session and listener. Idempotent. */
  close(): Promise<void>
}

type OwnedTool = { tool: ToolDefinition; brick?: Brick }

function collectTools(target: Brick | Structure): OwnedTool[] {
  const owned: OwnedTool[] =
    'bricks' in target
      ? target.bricks.flatMap((brick) => brick.toolset().map((tool) => ({ tool, brick })))
      : target.toolset().map((tool) => ({ tool, brick: target }))

  const seen = new Set<string>()
  for (const { tool } of owned) {
    if (seen.has(tool.name)) throw new Error(`serveMcp: duplicate tool name "${tool.name}"`)
    seen.add(tool.name)
  }

  return owned
}

function textResult(text: string, isError = false) {
  return { content: [{ type: 'text' as const, text }], ...(isError ? { isError: true } : {}) }
}

function stringifyOutput(output: unknown): string {
  return typeof output === 'string' ? output : (JSON.stringify(output) ?? 'null')
}

function buildServer(owned: OwnedTool[], opts: ServeMcpOptions): Server {
  const server = new Server(
    { name: opts.name ?? 'intellibrix', version: opts.version ?? '1.0.0' },
    { capabilities: { tools: {} } },
  )
  const byName = new Map(owned.map((entry) => [entry.tool.name, entry]))

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: owned.map(({ tool }) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: { ...toolToJSONSchema(tool), type: 'object' as const },
    })),
  }))

  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const entry = byName.get(request.params.name)
    if (!entry) return textResult(`Unknown tool: ${request.params.name}`, true)
    const { tool, brick } = entry

    const runId = randomUUID()
    const ctx: ToolContext & McpToolContext = {
      brick,
      signal: extra.signal,
      runId,
      // Input comes from a remote caller, so it is untrusted by definition.
      trust: 'untrusted',
      sample: async (req: SamplingRequest) => {
        if (!server.getClientCapabilities()?.sampling)
          throw new Error('The connected MCP client does not support sampling')
        const result = await server.createMessage({
          messages: req.messages.flatMap((message) =>
            message.role === 'user' || message.role === 'assistant'
              ? partsToContentBlocks(message.content).map((content) => ({
                  role: message.role as 'user' | 'assistant',
                  content: content as { type: 'text'; text: string },
                }))
              : [],
          ),
          systemPrompt: req.system,
          maxTokens: req.maxTokens ?? 1024,
          temperature: req.temperature,
        })
        return {
          message: { role: 'assistant', content: contentToParts(result.content) },
          model: result.model,
        }
      },
      elicit: async (req: ElicitationRequest) => {
        const result = await server.elicitInput({
          message: req.message,
          requestedSchema: req.schema as never,
        })
        if (result.action === 'accept')
          return { action: 'accept', content: (result.content ?? {}) as Record<string, unknown> }
        return { action: result.action }
      },
    }

    try {
      let input = await validateToolInput(tool, request.params.arguments ?? {})

      if (await resolveNeedsApproval(tool, input, ctx)) {
        const decision = opts.onToolApproval
          ? await opts.onToolApproval({ toolName: tool.name, input, runId, trust: ctx.trust })
          : false
        if (decision === false) return textResult('Tool call denied by approval policy', true)
        if (typeof decision === 'object' && 'edit' in decision) input = decision.edit
      }

      return textResult(stringifyOutput(await tool.execute(input, ctx)))
    } catch (error) {
      return textResult(error instanceof Error ? error.message : String(error), true)
    }
  })

  return server
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString('utf8')
}

async function serveHttp(
  makeServer: () => Server,
  opts: ServeMcpOptions,
): Promise<McpServerHandle> {
  const path = opts.path ?? '/mcp'
  const sessions = new Map<string, { server: Server; transport: StreamableHTTPServerTransport }>()

  const httpServer: HttpServer = createHttpServer(async (req, res) => {
    try {
      if (new URL(req.url ?? '/', 'http://localhost').pathname !== path) {
        res.writeHead(404).end()
        return
      }

      const body = req.method === 'POST' ? JSON.parse(await readBody(req)) : undefined
      const header = req.headers['mcp-session-id']
      let session = typeof header === 'string' ? sessions.get(header) : undefined

      if (!session) {
        if (req.method !== 'POST' || !isInitializeRequest(body)) {
          res.writeHead(400, { 'content-type': 'application/json' })
          res.end(
            JSON.stringify({
              jsonrpc: '2.0',
              error: { code: -32000, message: 'Missing or unknown session' },
              id: null,
            }),
          )
          return
        }

        const server = makeServer()
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: randomUUID,
          onsessioninitialized: (id) => {
            sessions.set(id, { server, transport })
          },
        })
        transport.onclose = () => {
          if (transport.sessionId) sessions.delete(transport.sessionId)
        }
        await server.connect(transport)
        session = { server, transport }
      }

      await session.transport.handleRequest(req, res, body)
    } catch {
      if (!res.headersSent) res.writeHead(400)
      res.end()
    }
  })

  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject)
    httpServer.listen(opts.port ?? 3000, opts.host ?? '127.0.0.1', resolve)
  })

  const address = httpServer.address() as AddressInfo
  const host = opts.host ?? '127.0.0.1'

  let closing: Promise<void> | undefined
  return {
    url: `http://${host}:${address.port}${path}`,
    close: () => {
      closing ??= (async () => {
        await Promise.all([...sessions.values()].map(({ server }) => server.close()))
        sessions.clear()
        httpServer.closeAllConnections()
        await new Promise<void>((resolve) => httpServer.close(() => resolve()))
      })()
      return closing
    },
  }
}

/**
 * Exposes a Brick (its programs plus attached tools) or a whole Structure
 * (merged across its bricks; duplicate names throw at startup, not call time)
 * as an MCP server.
 *
 * Tool `execute` functions receive `ctx.sample()` / `ctx.elicit()` (see
 * {@link McpToolContext}) to call back into the connected client's LLM or user.
 */
export async function serveMcp(
  target: Brick | Structure,
  opts: ServeMcpOptions,
): Promise<McpServerHandle> {
  const owned = collectTools(target)

  if (opts.transport === 'http') return serveHttp(() => buildServer(owned, opts), opts)

  const server = buildServer(owned, opts)
  await server.connect(opts.transport === 'stdio' ? new StdioServerTransport() : opts.transport)

  let closing: Promise<void> | undefined
  return {
    close: () => {
      closing ??= server.close()
      return closing
    },
  }
}
