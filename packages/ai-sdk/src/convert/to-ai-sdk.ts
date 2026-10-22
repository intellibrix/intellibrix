import type { AssistantContent, ModelMessage, ToolContent, UserContent } from 'ai'
import {
  isFilePart,
  isImagePart,
  isTextPart,
  isToolCallPart,
  isToolResultPart,
  type Message,
} from 'intellibrix'

/**
 * Converts intellibrix's normalized {@link Message} array into AI SDK's
 * `ModelMessage[]` shape. `system` messages become AI SDK `system` messages;
 * `tool` messages become AI SDK `tool` messages carrying tool-result parts.
 */
export function toAiSdkMessages(messages: Message[]): ModelMessage[] {
  return messages.map(toAiSdkMessage)
}

function toAiSdkMessage(message: Message): ModelMessage {
  switch (message.role) {
    case 'system': {
      const text = message.content.filter(isTextPart).map((part) => part.text)
      return { role: 'system', content: text.join('') }
    }

    case 'user': {
      const content: UserContent = message.content.map((part) => {
        if (isTextPart(part)) return { type: 'text', text: part.text }
        if (isImagePart(part)) return { type: 'image', image: part.data, mediaType: part.mediaType }
        if (isFilePart(part)) {
          return {
            type: 'file',
            data: part.data,
            mediaType: part.mediaType ?? 'application/octet-stream',
            filename: part.filename,
          }
        }
        throw new Error(`Unsupported user Part type: ${part.type}`)
      })
      return { role: 'user', content }
    }

    case 'assistant': {
      const content: AssistantContent = message.content.map((part) => {
        if (isTextPart(part)) return { type: 'text', text: part.text }
        if (isToolCallPart(part)) {
          return {
            type: 'tool-call',
            toolCallId: part.toolCallId,
            toolName: part.toolName,
            input: part.input,
          }
        }
        throw new Error(`Unsupported assistant Part type: ${part.type}`)
      })
      return { role: 'assistant', content }
    }

    case 'tool': {
      const content: ToolContent = message.content.filter(isToolResultPart).map((part) => ({
        type: 'tool-result',
        toolCallId: part.toolCallId,
        toolName: part.toolName,
        output: { type: 'json', value: part.output as any },
      }))
      return { role: 'tool', content }
    }

    default:
      throw new Error(`Unsupported message role: ${message.role}`)
  }
}
