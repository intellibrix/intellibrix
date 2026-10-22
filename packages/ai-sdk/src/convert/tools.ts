import { type ToolSet, tool } from 'ai'
import type { ToolDefinition } from 'intellibrix'

/**
 * Converts intellibrix `ToolDefinition[]` into an AI SDK `ToolSet`, declared
 * schema-only with no `execute` attached, so AI SDK returns control to the
 * caller on a tool-call finish reason instead of looping internally.
 */
export function toAiSdkTools(tools: ToolDefinition[] | undefined): ToolSet | undefined {
  if (!tools || tools.length === 0) return undefined

  const toolSet: ToolSet = {}
  for (const def of tools) {
    toolSet[def.name] = tool({
      description: def.description,
      inputSchema: def.input,
    })
  }

  return toolSet
}
