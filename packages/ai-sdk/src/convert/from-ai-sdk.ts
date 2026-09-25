import type {
  FinishReason as AiSdkFinishReason,
  ContentPart,
  LanguageModelUsage,
  ToolSet,
} from 'ai'
import type { FinishReason, Message, Part, StepResult, Usage } from 'intellibrix'

/**
 * Converts an AI SDK `finishReason` into intellibrix's {@link FinishReason}.
 * The two unions are string-for-string identical; this is a type-level
 * re-tag, not a remapping.
 */
export function fromAiSdkFinishReason(reason: AiSdkFinishReason): FinishReason {
  return reason
}

/**
 * Converts an AI SDK `LanguageModelUsage` into intellibrix's {@link Usage}.
 */
export function fromAiSdkUsage(usage: LanguageModelUsage): Usage {
  return {
    inputTokens: usage.inputTokens ?? undefined,
    outputTokens: usage.outputTokens ?? undefined,
    totalTokens: usage.totalTokens ?? undefined,
  }
}

/**
 * Converts a single generated step's AI SDK content array into intellibrix's
 * assistant {@link Message}.
 */
export function fromAiSdkContent(content: ContentPart<ToolSet>[]): Message {
  const parts: Part[] = []

  for (const part of content) {
    if (part.type === 'text') {
      parts.push({ type: 'text', text: part.text })
      continue
    }

    if (part.type === 'tool-call') {
      parts.push({
        type: 'tool-call',
        toolCallId: part.toolCallId,
        toolName: part.toolName,
        input: part.input,
      })
    }

    // reasoning, source, file, tool-result, tool-error, and approval parts
    // are not represented in intellibrix's Part union (yet) — dropped rather
    // than thrown, since a step may legitimately contain them alongside text
    // and tool calls we do care about.
  }

  return { role: 'assistant', content: parts }
}

/**
 * Converts a single-step AI SDK `generateText` result's essentials into
 * intellibrix's {@link StepResult}.
 */
export function fromAiSdkStep(
  content: ContentPart<ToolSet>[],
  finishReason: AiSdkFinishReason,
  usage: LanguageModelUsage,
): StepResult {
  return {
    message: fromAiSdkContent(content),
    finishReason: fromAiSdkFinishReason(finishReason),
    usage: fromAiSdkUsage(usage),
  }
}
