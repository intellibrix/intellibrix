import type { Brick, Message, ToolDefinition } from 'intellibrix'
import type { StructuresEventHandler } from './events.js'

/**
 * Sentinel returned by a `'continue'`-mode handoff tool, recognized by
 * `loop.ts`'s opt-in handoff hook to swap `system`/`tools` mid-run without
 * terminating the current turn.
 */
export type HandoffContinueSentinel = {
  __handoffContinue: true
  brick: Brick
}

/**
 * Options for {@link handoffTool}.
 */
export type HandoffOptions = {
  /** The target brick to transfer control to. */
  to: Brick
  /**
   * `'delegate'` (default): terminates the current turn and invokes the
   * target's own `ask()` fresh, seeded with prior history rendered as a
   * prompt via `getCurrentHistory()`.
   *
   * `'continue'` (advanced/opt-in): returns a `__handoffContinue` sentinel
   * instead of a plain string result, for a caller-provided `loop.ts` hook
   * that recognizes it and swaps `system`/`tools` mid-run.
   */
  mode?: 'delegate' | 'continue'
  /** Required in `'delegate'` mode: renders prior conversation history as a prompt for the target brick. */
  getCurrentHistory?: () => Message[] | Promise<Message[]>
  onEvent?: StructuresEventHandler
  name?: string
  description?: string
}

function renderHistory(messages: Message[]): string {
  return messages
    .map((message) => {
      const text = message.content
        .map((part) => (part.type === 'text' ? part.text : `[${part.type}]`))
        .join(' ')
      return `${message.role}: ${text}`
    })
    .join('\n')
}

/**
 * A `ToolDefinition` transferring control to another brick. Two modes: see
 * {@link HandoffOptions.mode}.
 */
export function handoffTool(
  opts: HandoffOptions,
): ToolDefinition<{ reason?: string }, string | HandoffContinueSentinel> {
  const mode = opts.mode ?? 'delegate'

  return {
    name: opts.name ?? `handoff_to_${opts.to.name}`,
    description: opts.description ?? `Transfer this conversation to the "${opts.to.name}" brick`,
    input: {
      '~standard': {
        version: 1,
        vendor: 'intellibrix',
        validate: (value: unknown) => ({ value: (value ?? {}) as { reason?: string } }),
      },
    },
    execute: async (_input, ctx) => {
      opts.onEvent?.({
        type: 'structure:hop',
        runId: ctx.runId,
        to: opts.to.name,
        kind: 'handoff',
      })

      if (mode === 'continue') return { __handoffContinue: true, brick: opts.to }

      if (!opts.getCurrentHistory)
        throw new Error('handoffTool: "delegate" mode requires getCurrentHistory')

      const history = await opts.getCurrentHistory()
      const prompt = renderHistory(history)
      const result = await opts.to.ask(prompt, { runId: ctx.runId })
      return result.text
    },
  }
}
