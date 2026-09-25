import type { LanguageModelV2, LanguageModelV2CallOptions } from '@ai-sdk/provider'
import { defineTool, textMessage } from 'intellibrix'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { aiSdkProvider } from '../src/provider.js'

/**
 * A hand-written fake `LanguageModelV2` — no network calls. Scripted with a
 * single canned response so tests are deterministic.
 */
function fakeLanguageModel(
  respond: (options: LanguageModelV2CallOptions) => {
    content: any[]
    finishReason: 'stop' | 'tool-calls'
    usage: { inputTokens: number; outputTokens: number; totalTokens: number }
  },
): LanguageModelV2 {
  return {
    specificationVersion: 'v2',
    provider: 'fake',
    modelId: 'fake-model',
    supportedUrls: {},
    async doGenerate(options: LanguageModelV2CallOptions) {
      const result = respond(options)
      return {
        content: result.content,
        finishReason: result.finishReason,
        usage: result.usage,
        warnings: [],
      } as any
    },
    async doStream(options: LanguageModelV2CallOptions) {
      const result = respond(options)
      const stream = new ReadableStream({
        start(controller) {
          for (const part of result.content as any[]) {
            if (part.type === 'text') {
              controller.enqueue({ type: 'text-start', id: '1' })
              controller.enqueue({ type: 'text-delta', id: '1', delta: part.text })
              controller.enqueue({ type: 'text-end', id: '1' })
            } else if (part.type === 'tool-call') {
              controller.enqueue({ ...part })
            }
          }
          controller.enqueue({
            type: 'finish',
            finishReason: result.finishReason,
            usage: result.usage,
          })
          controller.close()
        },
      })
      return { stream, warnings: [] } as any
    },
  } as LanguageModelV2
}

describe('@intellibrix/ai-sdk aiSdkProvider', () => {
  it('performs one generate() step and returns a text reply', async () => {
    const model = fakeLanguageModel(() => ({
      content: [{ type: 'text', text: 'hello from fake model' }],
      finishReason: 'stop',
      usage: { inputTokens: 3, outputTokens: 4, totalTokens: 7 },
    }))

    const provider = aiSdkProvider(model)
    const result = await provider.generate({
      model: 'fake-model',
      messages: [textMessage('user', 'hi')],
    })

    expect(result.finishReason).toBe('stop')
    expect(result.usage?.totalTokens).toBe(7)
    expect(result.message.content[0]).toMatchObject({ type: 'text', text: 'hello from fake model' })
  })

  it('declares tools schema-only (no execute attached)', async () => {
    let capturedTools: unknown
    const model = fakeLanguageModel((options) => {
      capturedTools = options.tools
      return {
        content: [
          {
            type: 'tool-call',
            toolCallId: 'call_1',
            toolName: 'echo',
            input: JSON.stringify({ text: 'hi' }),
          },
        ],
        finishReason: 'tool-calls',
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      }
    })

    const echoTool = defineTool({
      name: 'echo',
      description: 'Echoes input',
      input: z.object({ text: z.string() }),
      execute: async (input) => input.text,
    })

    const provider = aiSdkProvider(model)
    const result = await provider.generate({
      model: 'fake-model',
      messages: [textMessage('user', 'echo hi')],
      tools: [echoTool],
    })

    expect(result.finishReason).toBe('tool-calls')
    const toolCall = result.message.content.find((part) => part.type === 'tool-call')
    expect(toolCall).toMatchObject({ toolName: 'echo' })
    expect(Array.isArray(capturedTools)).toBe(true)
    expect((capturedTools as any[])[0]).not.toHaveProperty('execute')
  })

  it('streams text-delta and finish events', async () => {
    const model = fakeLanguageModel(() => ({
      content: [{ type: 'text', text: 'streamed' }],
      finishReason: 'stop',
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    }))

    const provider = aiSdkProvider(model)
    const events: string[] = []
    for await (const event of provider.stream({
      model: 'fake-model',
      messages: [textMessage('user', 'hi')],
    })) {
      events.push(event.type)
    }

    expect(events).toContain('text-delta')
    expect(events).toContain('finish')
  })
})
