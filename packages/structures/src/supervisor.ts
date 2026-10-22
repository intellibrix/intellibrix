import type { Brick, Intelligence, ToolDefinition } from 'intellibrix'
import { asTool } from './as-tool.js'
import type { StructuresEventHandler } from './events.js'
import { assertDepth } from './limits.js'

/**
 * Options for {@link supervisor}.
 */
export type SupervisorOptions = {
  supervisor: Intelligence
  bricks: Brick[]
  /** Maximum delegation depth before a {@link DepthExceededError} is thrown. Default 3. */
  maxDepth?: number
  /** Overrides the default per-brick tool wrapping (defaults to {@link asTool}). */
  toolFactory?: (brick: Brick) => ToolDefinition[]
  onEvent?: StructuresEventHandler
}

/**
 * The result of asking a `supervisor()`.
 */
export type SupervisorResult = {
  text: string
}

/**
 * Wires the parent `supervisor` Intelligence's tool list to the given
 * `bricks`, each wrapped (by default) as a single opaque tool via
 * {@link asTool}, so nested delegation happens through the existing
 * agent-loop tool-dispatch machinery, with no new execution engine. Depth is
 * threaded explicitly through the closure, incremented per hop and checked
 * against `maxDepth` (default 3).
 */
export function supervisor(opts: SupervisorOptions) {
  const maxDepth = opts.maxDepth ?? 3

  const buildTools = (depth: number): ToolDefinition[] => {
    assertDepth(depth, maxDepth)
    return opts.bricks.flatMap((brick) => opts.toolFactory?.(brick) ?? [asTool(brick)])
  }

  return {
    async ask(prompt: string, runId?: string): Promise<SupervisorResult> {
      const depth = 1
      const tools = buildTools(depth)
      for (const tool of tools) {
        opts.onEvent?.({
          type: 'structure:hop',
          runId: runId ?? 'unknown',
          to: tool.name,
          kind: 'supervisor',
          depth,
        })
      }

      const result = await opts.supervisor.ask(prompt, { tools, runId })
      return { text: result.text }
    },
  }
}
