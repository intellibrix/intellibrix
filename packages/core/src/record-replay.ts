import type { GenerateRequest, Provider, StepResult, StreamEvent } from './provider.js'

/**
 * One recorded `generate()` call: the (serializable) request and the result
 * it produced.
 */
export type RecordedStep = {
  request: SerializableGenerateRequest
  result: StepResult
}

/**
 * `GenerateRequest` minus non-serializable fields (`abortSignal`, and tool
 * `execute`/`needsApproval` functions; tools are reduced to their
 * name/description/schema).
 */
export type SerializableGenerateRequest = Omit<GenerateRequest, 'abortSignal' | 'tools'> & {
  tools?: Array<{ name: string; description: string }>
}

function toSerializableRequest(req: GenerateRequest): SerializableGenerateRequest {
  const { abortSignal, tools, ...rest } = req
  void abortSignal
  return {
    ...rest,
    tools: tools?.map((tool) => ({ name: tool.name, description: tool.description })),
  }
}

/**
 * Wraps a real {@link Provider}, intercepting every `generate`/`stream` call
 * and reporting the (serialized) request/result pair to `onRecord`.
 * Persistence is the caller's job, so this stays filesystem-free.
 */
export function recordProvider(
  inner: Provider,
  opts: { onRecord: (step: RecordedStep) => void | Promise<void> },
): Provider {
  return {
    id: inner.id,
    async generate(req) {
      const result = await inner.generate(req)
      await opts.onRecord({ request: toSerializableRequest(req), result })
      return result
    },
    async *stream(req) {
      let finalResult: StepResult | undefined
      for await (const event of inner.stream(req)) {
        if (event.type === 'finish') finalResult = event.result
        yield event
      }
      if (finalResult)
        await opts.onRecord({ request: toSerializableRequest(req), result: finalResult })
    },
    embed: inner.embed?.bind(inner),
    image: inner.image?.bind(inner),
  }
}

/**
 * Plays back a fixed array of {@link RecordedStep}s in call order. Throws
 * (`replayProvider: fixtures exhausted`) when the run asks for more steps than were recorded.
 */
export function replayProvider(fixtures: RecordedStep[]): Provider {
  let index = 0

  function next(): RecordedStep {
    const fixture = fixtures[index]
    if (!fixture) throw new Error('replayProvider: fixtures exhausted')
    index += 1
    return fixture
  }

  return {
    id: 'replay',
    async generate() {
      return next().result
    },
    async *stream(): AsyncIterable<StreamEvent> {
      const { result } = next()
      for (const part of result.message.content) {
        if (part.type === 'text') yield { type: 'text-delta', text: part.text }
        if (part.type === 'tool-call') {
          yield {
            type: 'tool-call',
            toolCallId: part.toolCallId,
            toolName: part.toolName,
            input: part.input,
          }
        }
      }
      yield { type: 'finish', result }
    },
  }
}
