/**
 * Trust level of a {@link Part}. Defaults to `'trusted'` when omitted, so
 * hand-written messages need no change. Content fetched or read from outside
 * the process — workspace reads, GitHub data, MCP tool results, HTTP fetches —
 * should be tagged `'untrusted'` at the point of creation. This is the concrete
 * surface for indirect prompt-injection defense: `loop.ts`'s tool dispatch and
 * `tool.ts`'s `needsApproval` predicate both receive this status alongside a
 * call, so a guardrail policy can key off it.
 */
export type Trust = 'trusted' | 'untrusted'

/**
 * A block of text content.
 */
export type TextPart = {
  type: 'text'
  text: string
  trust?: Trust
}

/**
 * An image, referenced by URL or inlined as base64 data.
 */
export type ImagePart = {
  type: 'image'
  /** A URL, or a base64-encoded data string. */
  data: string
  mediaType?: string
  trust?: Trust
}

/**
 * An arbitrary file attachment, referenced by URL or inlined as base64 data.
 */
export type FilePart = {
  type: 'file'
  data: string
  mediaType?: string
  filename?: string
  trust?: Trust
}

/**
 * A request from the model to call a tool.
 */
export type ToolCallPart = {
  type: 'tool-call'
  toolCallId: string
  toolName: string
  input: unknown
  trust?: Trust
}

/**
 * The result of executing a tool call.
 */
export type ToolResultPart = {
  type: 'tool-result'
  toolCallId: string
  toolName: string
  output: unknown
  isError?: boolean
  trust?: Trust
}

/**
 * A single unit of content within a {@link Message}.
 */
export type Part = TextPart | ImagePart | FilePart | ToolCallPart | ToolResultPart

/**
 * The role of a message's author.
 */
export type Role = 'system' | 'user' | 'assistant' | 'tool'

/**
 * A normalized chat message, provider-agnostic.
 */
export type Message = {
  role: Role
  content: Part[]
}

/** Type guard for {@link TextPart}. */
export function isTextPart(part: Part): part is TextPart {
  return part.type === 'text'
}

/** Type guard for {@link ImagePart}. */
export function isImagePart(part: Part): part is ImagePart {
  return part.type === 'image'
}

/** Type guard for {@link FilePart}. */
export function isFilePart(part: Part): part is FilePart {
  return part.type === 'file'
}

/** Type guard for {@link ToolCallPart}. */
export function isToolCallPart(part: Part): part is ToolCallPart {
  return part.type === 'tool-call'
}

/** Type guard for {@link ToolResultPart}. */
export function isToolResultPart(part: Part): part is ToolResultPart {
  return part.type === 'tool-result'
}

/**
 * Convenience constructor for a single-text-part {@link Message}.
 * @param role The role of the message's author.
 * @param text The text content of the message.
 * @param trust The trust level of the text content. Defaults to `'trusted'` when omitted.
 */
export function textMessage(role: Role, text: string, trust?: Trust): Message {
  return { role, content: [{ type: 'text', text, ...(trust ? { trust } : {}) }] }
}

/**
 * Extracts and concatenates all text parts of a {@link Message}.
 * @param message The message to extract text from.
 */
export function textOf(message: Message): string {
  return message.content
    .filter(isTextPart)
    .map((part) => part.text)
    .join('')
}
