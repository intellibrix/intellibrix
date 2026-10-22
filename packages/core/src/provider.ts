import type { Message } from './messages.js'
import type { ToolDefinition } from './tool.js'

/**
 * Token usage reported by a single model step.
 */
export type Usage = {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
}

/**
 * The reason a model step finished.
 */
export type FinishReason = 'stop' | 'tool-calls' | 'length' | 'content-filter' | 'error' | 'other'

/**
 * A request for a single model step.
 */
export type GenerateRequest = {
  model: string
  system?: string
  messages: Message[]
  tools?: ToolDefinition[]
  toolChoice?: 'auto' | 'none' | 'required' | { toolName: string }
  maxOutputTokens?: number
  temperature?: number
  abortSignal?: AbortSignal
}

/**
 * The result of a single model step.
 */
export type StepResult = {
  message: Message
  finishReason: FinishReason
  usage?: Usage
}

/**
 * A single streamed event during a model step.
 */
export type StreamEvent =
  | { type: 'text-delta'; text: string }
  | { type: 'tool-call'; toolCallId: string; toolName: string; input: unknown }
  | { type: 'finish'; result: StepResult }
  | { type: 'error'; error: unknown }

/**
 * Options for an embedding request.
 */
export type EmbedOptions = {
  model?: string
}

/**
 * Options for an image-generation request.
 */
export type ImageOptions = {
  model?: string
  size?: string
}

/**
 * A model provider. Implementations perform exactly **one** model step per
 * `generate`/`stream` call; {@link runAgentLoop} in `loop.ts` owns iteration.
 * This is the seam `@intellibrix/ai-sdk`'s adapters implement.
 */
export interface Provider {
  id: string
  generate(req: GenerateRequest): Promise<StepResult>
  stream(req: GenerateRequest): AsyncIterable<StreamEvent>
  embed?(input: string[], opts?: EmbedOptions): Promise<number[][]>
  image?(prompt: string, opts?: ImageOptions): Promise<{ url?: string; data?: string }>
}
