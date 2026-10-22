import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { CreateMessageRequestSchema, ElicitRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { fromJSONSchema, type ToolDefinition } from 'intellibrix'
import {
  contentToParts,
  type ElicitationRequest,
  type ElicitationResult,
  type SamplingRequest,
  type SamplingResult,
} from './sampling.js'

export type McpTransportOptions =
  | {
      transport: 'stdio'
      command: string
      args?: string[]
      env?: Record<string, string>
      cwd?: string
    }
  | { transport: 'http'; url: string; headers?: Record<string, string> }
  | { transport: Transport }

export type McpToolsOptions = McpTransportOptions & {
  clientInfo?: { name: string; version: string }
  /**
   * Answers the server's `sampling/createMessage` requests. Without it the
   * sampling capability is not advertised, so servers cannot request it.
   */
  onSamplingRequest?: (request: SamplingRequest) => Promise<SamplingResult>
  /**
   * Answers the server's `elicitation/create` requests. Without it the
   * elicitation capability is not advertised.
   */
  onElicitation?: (request: ElicitationRequest) => Promise<ElicitationResult>
  /** Overrides approval gating for every mounted tool. Defaults to gating tools annotated `destructiveHint: true`. */
  needsApproval?: ToolDefinition['needsApproval']
}

export type McpToolsHandle = {
  tools: ToolDefinition[]
  client: Client
  /** Closes the connection (and any spawned process). Idempotent. Callers must call it, or the transport leaks. */
  close(): Promise<void>
}

function createTransport(opts: McpTransportOptions): Transport {
  if (typeof opts.transport !== 'string') return opts.transport
  if (opts.transport === 'stdio') {
    const stdio = opts as Extract<McpTransportOptions, { transport: 'stdio' }>
    return new StdioClientTransport({
      command: stdio.command,
      args: stdio.args,
      env: stdio.env,
      cwd: stdio.cwd,
    })
  }
  const http = opts as Extract<McpTransportOptions, { transport: 'http' }>
  return new StreamableHTTPClientTransport(new URL(http.url), {
    requestInit: http.headers ? { headers: http.headers } : undefined,
  })
}

type McpContentBlock = { type: string; text?: string }

function mapCallResult(raw: object): unknown {
  const result = raw as { content?: unknown; structuredContent?: unknown; isError?: boolean }
  const blocks = (Array.isArray(result.content) ? result.content : []) as McpContentBlock[]
  const allText = blocks.every((block) => block.type === 'text')
  const text = blocks.map((block) => block.text ?? '').join('\n')

  if (result.isError) throw new Error(text || 'MCP tool call failed')
  if (result.structuredContent !== undefined) return result.structuredContent
  return allText ? text : blocks
}

/**
 * Connects to an MCP server and mounts each of its tools as an intellibrix
 * {@link ToolDefinition}. Results are tagged `resultTrust: 'untrusted'`, since
 * remote tool output is exactly the class of content the trust model exists for.
 */
export async function mcpTools(opts: McpToolsOptions): Promise<McpToolsHandle> {
  const client = new Client(opts.clientInfo ?? { name: 'intellibrix', version: '1.0.0' }, {
    capabilities: {
      ...(opts.onSamplingRequest ? { sampling: {} } : {}),
      ...(opts.onElicitation ? { elicitation: {} } : {}),
    },
  })

  const { onSamplingRequest, onElicitation } = opts

  if (onSamplingRequest) {
    client.setRequestHandler(CreateMessageRequestSchema, async (request) => {
      const params = request.params
      const result = await onSamplingRequest({
        messages: params.messages.flatMap((message) => {
          const parts = contentToParts(message.content)
          return parts.length > 0 ? [{ role: message.role, content: parts }] : []
        }),
        system: params.systemPrompt,
        maxTokens: params.maxTokens,
        temperature: params.temperature,
      })
      const text = result.message.content.flatMap((part) =>
        part.type === 'text' ? [part.text] : [],
      )
      return {
        model: result.model ?? 'unknown',
        role: 'assistant' as const,
        content: { type: 'text' as const, text: text.join('') },
        stopReason: 'endTurn',
      }
    })
  }

  if (onElicitation) {
    client.setRequestHandler(ElicitRequestSchema, async (request) => {
      const params = request.params as { message: string; requestedSchema?: unknown }
      return onElicitation({
        message: params.message,
        schema: (params.requestedSchema ?? {
          type: 'object',
          properties: {},
        }) as ElicitationRequest['schema'],
      })
    })
  }

  await client.connect(createTransport(opts))

  const remoteTools: Awaited<ReturnType<Client['listTools']>>['tools'] = []
  let cursor: string | undefined
  do {
    const page = await client.listTools(cursor ? { cursor } : undefined)
    remoteTools.push(...page.tools)
    cursor = page.nextCursor
  } while (cursor)

  const tools: ToolDefinition[] = remoteTools.map((remote) => ({
    name: remote.name,
    description: remote.description ?? remote.name,
    input: fromJSONSchema(remote.inputSchema as Record<string, unknown>),
    resultTrust: 'untrusted' as const,
    needsApproval: opts.needsApproval ?? remote.annotations?.destructiveHint === true,
    execute: async (input, ctx) =>
      mapCallResult(
        await client.callTool(
          { name: remote.name, arguments: (input ?? {}) as Record<string, unknown> },
          undefined,
          { signal: ctx.signal },
        ),
      ),
  }))

  let closing: Promise<void> | undefined
  return {
    tools,
    client,
    close: () => {
      closing ??= client.close()
      return closing
    },
  }
}
