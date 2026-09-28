import type { Checkpointer } from './checkpoint.js'
import type { ConversationMemory } from './database.js'
import type { RunEventHandler } from './events.js'
import { type ApprovalHook, type LoopEvent, runAgentLoop } from './loop.js'
import { type Message, textMessage, textOf } from './messages.js'
import type { Provider, StreamEvent, Usage } from './provider.js'
import type { ToolDefinition } from './tool.js'
import { defaultPriceTable, type PriceTable, UsageAccumulator } from './usage.js'

/**
 * Options for creating an {@link Intelligence} instance.
 */
export type IntelligenceOptions = {
  provider: Provider
  model: string
  system?: string
  tools?: ToolDefinition[]
  maxSteps?: number
  onToolApproval?: ApprovalHook
  onEvent?: (event: LoopEvent) => void
  onRunEvent?: RunEventHandler
  checkpointer?: Checkpointer
  /** Optional conversation memory; combine with `threadId` on `ask`/`stream`. */
  memory?: ConversationMemory
  /** Price table for this instance's `usage` accumulator. Defaults to `defaultPriceTable`. */
  priceTable?: PriceTable
}

/**
 * Options for a single `ask`/`stream` call.
 */
export type AskOptions = {
  tools?: ToolDefinition[]
  maxSteps?: number
  onToolApproval?: ApprovalHook
  onEvent?: (event: LoopEvent) => void
  onRunEvent?: RunEventHandler
  abortSignal?: AbortSignal
  runId?: string
  brick?: unknown
  /** Annotates this call's `run:start`/`run:finish` `RunEvent`s. */
  brickName?: string
  /** Conversation thread id; requires `memory` to be set on the constructor. */
  threadId?: string
}

export type AskResult = {
  text: string
  messages: Message[]
  steps: number
  usage: Usage
}

/**
 * Represents an intelligence service that can be used by a {@link Brick} to
 * process and respond to messages, backed by any {@link Provider}.
 */
export default class Intelligence {
  provider: Provider
  model: string
  system: string
  tools: ToolDefinition[]
  maxSteps: number
  onToolApproval?: ApprovalHook
  onEvent?: (event: LoopEvent) => void
  onRunEvent?: RunEventHandler
  checkpointer?: Checkpointer
  memory?: ConversationMemory
  /** Accumulates token usage/cost across every `ask`/`object` call on this instance. */
  usage: UsageAccumulator

  constructor(options: IntelligenceOptions) {
    this.provider = options.provider
    this.model = options.model
    this.system = options.system ?? 'You are a friendly assistant, ready to help with any task'
    this.tools = options.tools ?? []
    this.maxSteps = options.maxSteps ?? 10
    this.onToolApproval = options.onToolApproval
    this.onEvent = options.onEvent
    this.onRunEvent = options.onRunEvent
    this.checkpointer = options.checkpointer
    this.memory = options.memory
    this.usage = new UsageAccumulator(options.priceTable ?? defaultPriceTable)
  }

  private async loadHistory(threadId?: string): Promise<Message[]> {
    if (!this.memory || !threadId) return []
    return this.memory.getMessages(threadId)
  }

  private async persist(threadId: string | undefined, userMessage: Message, replies: Message[]) {
    if (!this.memory || !threadId) return
    await this.memory.append(threadId, userMessage)
    for (const reply of replies) await this.memory.append(threadId, reply)
  }

  /**
   * Sends a prompt through the agent loop and returns the final result.
   */
  async ask(prompt: string | Message, options: AskOptions = {}): Promise<AskResult> {
    const userMessage: Message = typeof prompt === 'string' ? textMessage('user', prompt) : prompt
    const history = await this.loadHistory(options.threadId)
    const startLength = history.length

    const result = await runAgentLoop({
      provider: this.provider,
      model: this.model,
      system: this.system,
      messages: [...history, userMessage],
      tools: options.tools ?? this.tools,
      maxSteps: options.maxSteps ?? this.maxSteps,
      onToolApproval: options.onToolApproval ?? this.onToolApproval,
      onEvent: options.onEvent ?? this.onEvent,
      onRunEvent: options.onRunEvent ?? this.onRunEvent,
      brickName: options.brickName,
      abortSignal: options.abortSignal,
      runId: options.runId,
      brick: options.brick,
      checkpointer: this.checkpointer,
    })

    this.usage.add(result.usage, this.model)
    const newMessages = result.messages.slice(startLength + 1)
    await this.persist(options.threadId, userMessage, newMessages)

    const lastAssistant = [...result.messages]
      .reverse()
      .find((message) => message.role === 'assistant')

    return {
      text: lastAssistant ? textOf(lastAssistant) : '',
      messages: result.messages,
      steps: result.steps,
      usage: result.usage,
    }
  }

  /**
   * Sends a prompt through the agent loop, streaming events as they occur.
   */
  async *stream(prompt: string | Message, options: AskOptions = {}): AsyncIterable<StreamEvent> {
    const userMessage: Message = typeof prompt === 'string' ? textMessage('user', prompt) : prompt
    const history = await this.loadHistory(options.threadId)
    const startLength = history.length

    let finalMessages: Message[] = []
    let completed = false

    try {
      const request = {
        model: this.model,
        system: this.system,
        messages: [...history, userMessage],
        tools: options.tools ?? this.tools,
        abortSignal: options.abortSignal,
      }

      for await (const event of this.provider.stream(request)) {
        yield event
        if (event.type === 'finish') finalMessages = [...request.messages, event.result.message]
      }

      completed = true
    } finally {
      if (completed && finalMessages.length > 0) {
        const newMessages = finalMessages.slice(startLength + 1)
        await this.persist(options.threadId, userMessage, newMessages)
      }
    }
  }

  /**
   * Forces a structured response via a synthetic tool call matching `schema`,
   * returning its parsed input. Avoids per-provider JSON-mode plumbing.
   */
  async object<T>(schema: ToolDefinition<T>['input'], prompt: string | Message): Promise<T> {
    const userMessage: Message = typeof prompt === 'string' ? textMessage('user', prompt) : prompt
    let captured: T | undefined

    const responderTool: ToolDefinition<T> = {
      name: '_respond_with_schema',
      description: 'Respond with a value matching the required schema.',
      input: schema,
      execute: async (input) => {
        captured = input
        return input
      },
    }

    const result = await runAgentLoop({
      provider: this.provider,
      model: this.model,
      system: this.system,
      messages: [userMessage],
      tools: [responderTool],
      maxSteps: 2,
      stopWhen: () => captured !== undefined,
    })

    this.usage.add(result.usage, this.model)
    if (captured === undefined) throw new Error('Model did not produce a structured response')
    return captured
  }

  /**
   * Generates embeddings for the given input strings, if the provider supports it.
   */
  async embed(input: string[]): Promise<number[][]> {
    if (!this.provider.embed)
      throw new Error(`Provider "${this.provider.id}" does not support embed()`)
    return this.provider.embed(input)
  }

  /**
   * Generates an image from a prompt, if the provider supports it.
   */
  async image(prompt: string): Promise<{ url?: string; data?: string }> {
    if (!this.provider.image)
      throw new Error(`Provider "${this.provider.id}" does not support image()`)
    return this.provider.image(prompt)
  }
}

/**
 * Wraps a plain async function as a {@link Provider}, for simple custom
 * integrations that don't need the full agent-loop machinery.
 */
export function customProvider(fn: (prompt: string) => Promise<string>): Provider {
  return {
    id: 'custom',
    async generate(req) {
      const lastUser = [...req.messages].reverse().find((m) => m.role === 'user')
      const text = await fn(lastUser ? textOf(lastUser) : '')
      return { message: textMessage('assistant', text), finishReason: 'stop' }
    },
    async *stream(req) {
      const lastUser = [...req.messages].reverse().find((m) => m.role === 'user')
      const text = await fn(lastUser ? textOf(lastUser) : '')
      const message = textMessage('assistant', text)
      yield { type: 'text-delta', text }
      yield { type: 'finish', result: { message, finishReason: 'stop' } }
    },
  }
}
