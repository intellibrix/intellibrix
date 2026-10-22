import type { Message, Part, Provider } from 'intellibrix'
import { textMessage, textOf } from 'intellibrix'

/**
 * A request for the MCP peer's LLM to produce a completion (MCP `sampling/createMessage`),
 * expressed in intellibrix's own message shapes.
 */
export type SamplingRequest = {
  messages: Message[]
  system?: string
  maxTokens?: number
  temperature?: number
}

export type SamplingResult = {
  message: Message
  model?: string
}

/**
 * A request for the human on the MCP client to supply structured input
 * (MCP `elicitation/create`). `schema` is a flat JSON Schema object.
 */
export type ElicitationRequest = {
  message: string
  schema: { type: 'object'; properties: Record<string, unknown>; required?: string[] }
}

export type ElicitationResult =
  | { action: 'accept'; content: Record<string, unknown> }
  | { action: 'decline' }
  | { action: 'cancel' }

/**
 * Extra capabilities the MCP server wrapper adds to a tool's `ctx` while it
 * runs behind {@link serveMcp}. Both are absent outside an MCP call (e.g. when
 * the same tool runs inside a plain agent loop).
 */
export type McpToolContext = {
  /** Asks the connected MCP client's LLM for a completion. Rejects if the client didn't opt in. */
  sample?: (request: SamplingRequest) => Promise<SamplingResult>
  /** Asks the connected MCP client's user for structured input. Rejects if the client didn't opt in. */
  elicit?: (request: ElicitationRequest) => Promise<ElicitationResult>
}

type McpContentBlock = { type: string; text?: string; data?: string; mimeType?: string }

export function contentToParts(content: unknown): Part[] {
  const blocks = (Array.isArray(content) ? content : [content]) as McpContentBlock[]
  const parts: Part[] = []
  for (const block of blocks) {
    if (block?.type === 'text' && typeof block.text === 'string')
      parts.push({ type: 'text', text: block.text })
    else if (block?.type === 'image' && typeof block.data === 'string')
      parts.push({ type: 'image', data: block.data, mediaType: block.mimeType })
  }
  return parts
}

export function partsToContentBlocks(parts: Part[]): McpContentBlock[] {
  const blocks: McpContentBlock[] = []
  for (const part of parts) {
    if (part.type === 'text') blocks.push({ type: 'text', text: part.text })
    else if (part.type === 'image')
      blocks.push({ type: 'image', data: part.data, mimeType: part.mediaType ?? 'image/png' })
  }
  return blocks
}

/**
 * Builds an `onSamplingRequest` handler that answers MCP sampling requests
 * with any intellibrix {@link Provider}.
 */
export function samplingFromProvider(
  provider: Provider,
  model: string,
): (request: SamplingRequest) => Promise<SamplingResult> {
  return async (request) => {
    const result = await provider.generate({
      model,
      system: request.system,
      messages: request.messages,
      maxOutputTokens: request.maxTokens,
      temperature: request.temperature,
    })
    return { message: result.message, model }
  }
}

export { textMessage, textOf }
