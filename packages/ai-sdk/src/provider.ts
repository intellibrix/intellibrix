import {
  embed as aiSdkEmbed,
  generateImage as aiSdkGenerateImage,
  generateText,
  type LanguageModel,
  stepCountIs,
  streamText,
} from 'ai'
import type {
  EmbedOptions,
  GenerateRequest,
  ImageOptions,
  Provider,
  StepResult,
  StreamEvent,
} from 'intellibrix'
import { fromAiSdkFinishReason, fromAiSdkStep, fromAiSdkUsage } from './convert/from-ai-sdk.js'
import { toAiSdkMessages } from './convert/to-ai-sdk.js'
import { toAiSdkTools } from './convert/tools.js'

/**
 * Options for {@link aiSdkProvider}.
 */
export type AiSdkProviderOptions = {
  /** The model used for `embed()`, when the caller doesn't override it. */
  embeddingModel?: Parameters<typeof aiSdkEmbed>[0]['model']
  /** The model used for `image()`, when the caller doesn't override it. */
  imageModel?: Parameters<typeof aiSdkGenerateImage>[0]['model']
}

/**
 * Wraps an AI SDK `LanguageModel` as an intellibrix {@link Provider}.
 * `generate`/`stream` each perform exactly one model step (`stepCountIs(1)`)
 * (tools are declared schema-only via {@link toAiSdkTools}, with no
 * `execute` attached), so AI SDK always returns control to `loop.ts` on a
 * tool-call finish reason instead of looping internally.
 */
export function aiSdkProvider(model: LanguageModel, opts?: AiSdkProviderOptions): Provider {
  const id = typeof model === 'string' ? model : (model.modelId ?? 'ai-sdk')

  return {
    id,

    async generate(req: GenerateRequest): Promise<StepResult> {
      const result = await generateText({
        model,
        system: req.system,
        messages: toAiSdkMessages(req.messages),
        tools: toAiSdkTools(req.tools),
        toolChoice: req.toolChoice as any,
        maxOutputTokens: req.maxOutputTokens,
        temperature: req.temperature,
        abortSignal: req.abortSignal,
        stopWhen: stepCountIs(1),
      })

      return fromAiSdkStep(result.content as any, result.finishReason, result.usage)
    },

    async *stream(req: GenerateRequest): AsyncIterable<StreamEvent> {
      const result = streamText({
        model,
        system: req.system,
        messages: toAiSdkMessages(req.messages),
        tools: toAiSdkTools(req.tools),
        toolChoice: req.toolChoice as any,
        maxOutputTokens: req.maxOutputTokens,
        temperature: req.temperature,
        abortSignal: req.abortSignal,
        stopWhen: stepCountIs(1),
      })

      try {
        for await (const part of result.fullStream) {
          if (part.type === 'text-delta') {
            yield { type: 'text-delta', text: part.text }
          } else if (part.type === 'tool-call') {
            yield {
              type: 'tool-call',
              toolCallId: part.toolCallId,
              toolName: part.toolName,
              input: part.input,
            }
          } else if (part.type === 'error') {
            yield { type: 'error', error: part.error }
          }
        }

        const [content, finishReason, usage] = await Promise.all([
          result.content,
          result.finishReason,
          result.usage,
        ])

        yield { type: 'finish', result: fromAiSdkStep(content as any, finishReason, usage) }
      } catch (error) {
        yield { type: 'error', error }
      }
    },

    async embed(input: string[], embedOpts?: EmbedOptions): Promise<number[][]> {
      const model = opts?.embeddingModel
      if (!model) {
        throw new Error(
          'aiSdkProvider: embed() requires an `embeddingModel` to be configured via AiSdkProviderOptions',
        )
      }

      const embeddings: number[][] = []
      for (const value of input) {
        const result = await aiSdkEmbed({ model, value })
        embeddings.push(result.embedding)
      }

      void embedOpts
      return embeddings
    },

    async image(
      prompt: string,
      imageOpts?: ImageOptions,
    ): Promise<{ url?: string; data?: string }> {
      const model = opts?.imageModel
      if (!model) {
        throw new Error(
          'aiSdkProvider: image() requires an `imageModel` to be configured via AiSdkProviderOptions',
        )
      }

      const result = await aiSdkGenerateImage({
        model,
        prompt,
        size: imageOpts?.size as `${number}x${number}` | undefined,
      })

      return { data: result.image.base64 }
    },
  }
}

export { fromAiSdkFinishReason, fromAiSdkUsage }
