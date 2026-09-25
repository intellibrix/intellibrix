import { randomUUID } from 'node:crypto'

import { textMessage } from './messages.js'
import type {
  FinishReason,
  GenerateRequest,
  Provider,
  StepResult,
  StreamEvent,
} from './provider.js'

/**
 * A single scripted step for {@link MockProvider}: either a plain text reply
 * or one or more tool calls.
 */
export type MockStep =
  | { text: string; finishReason?: FinishReason }
  | { toolCalls: Array<{ toolName: string; input: unknown }>; finishReason?: FinishReason }

/**
 * A {@link Provider} implementation scripted with a fixed array of steps,
 * for deterministic tests with zero network calls. Each `generate`/`stream`
 * call consumes the next step in order; consuming past the end throws
 * `MockProvider: script exhausted`.
 */
export class MockProvider implements Provider {
  id = 'mock'
  #steps: MockStep[]
  #index = 0

  constructor(steps: MockStep[]) {
    this.#steps = steps
  }

  #next(): MockStep {
    const step = this.#steps[this.#index]
    if (!step) throw new Error('MockProvider: script exhausted')
    this.#index += 1
    return step
  }

  async generate(_req: GenerateRequest): Promise<StepResult> {
    const step = this.#next()

    if ('text' in step) {
      return {
        message: textMessage('assistant', step.text),
        finishReason: step.finishReason ?? 'stop',
      }
    }

    return {
      message: {
        role: 'assistant',
        content: step.toolCalls.map((call) => ({
          type: 'tool-call' as const,
          toolCallId: randomUUID(),
          toolName: call.toolName,
          input: call.input,
        })),
      },
      finishReason: step.finishReason ?? 'tool-calls',
    }
  }

  async *stream(req: GenerateRequest): AsyncIterable<StreamEvent> {
    const result = await this.generate(req)

    for (const part of result.message.content) {
      if (part.type === 'text') yield { type: 'text-delta', text: part.text }
      if (part.type === 'tool-call')
        yield {
          type: 'tool-call',
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          input: part.input,
        }
    }

    yield { type: 'finish', result }
  }
}

/**
 * Convenience helper for defining a simple mock tool in tests.
 */
export function mockTool<In = any, Out = any>(
  name: string,
  impl: (input: In) => Promise<Out> | Out,
  opts?: { description?: string },
) {
  return {
    name,
    description: opts?.description ?? `Mock tool "${name}"`,
    input: {
      '~standard': { version: 1, vendor: 'intellibrix', validate: (value: unknown) => ({ value }) },
    } as any,
    execute: async (input: In) => impl(input),
  }
}
