import { type ToolSet, tool } from 'ai'
import type { ToolDefinition } from 'intellibrix'

/**
 * Converts intellibrix `ToolDefinition[]` into an AI SDK `ToolSet`, declared
 * schema-only with no `execute` attached. This is deliberate: with no
 * `execute`, AI SDK always returns control to the caller on a tool-call
 * finish reason instead of looping internally, preserving the one-model-step-
 * per-call invariant `loop.ts` depends on.
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
