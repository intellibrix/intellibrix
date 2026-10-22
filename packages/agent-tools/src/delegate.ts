import { type AskResult, defineTool, type ToolContext, type ToolDefinition } from 'intellibrix'
import { z } from 'zod'

/** Anything that answers a prompt: an `Intelligence`, a `Brick`, or your own wrapper. */
export type Delegate = {
  ask(
    prompt: string,
    options?: { abortSignal?: AbortSignal; maxSteps?: number },
  ): Promise<AskResult>
}

export type DelegateToolOptions = {
  /** The sub-agents the model may hand work to, by name. */
  agents: Record<string, { agent: Delegate; description: string }>
  /** Step budget for each delegated run. Defaults to the sub-agent's own. */
  maxSteps?: number
  /**
   * Tag the sub-agent's answer `trusted`. Leave this off unless the sub-agent never reads outside
   * content: a sub-agent that read a hostile file can pass its instructions on in its answer.
   * @default false
   */
  trusted?: boolean
  /** Called when a delegated run finishes, e.g. to log or meter it. */
  onResult?: (name: string, result: AskResult, ctx: ToolContext) => void
}

/**
 * A `delegate` tool: the model hands a self-contained task to a named sub-agent and gets back its
 * final answer. The sub-agent keeps its own conversation, tools and approval policy, so configure
 * `onToolApproval` on its `Intelligence`; delegation never widens what a tool call is allowed to
 * do. Do not give the sub-agent this tool, or it can delegate to itself without limit.
 */
export function delegateTool(options: DelegateToolOptions): ToolDefinition {
  const names = Object.keys(options.agents)
  if (names.length === 0) throw new Error('delegateTool needs at least one agent')
  const roster = names.map((n) => `${n}: ${options.agents[n]?.description}`).join('; ')
  return defineTool({
    name: 'delegate',
    description: `Hand a self-contained task to a sub-agent and get its final answer. The sub-agent cannot see this conversation, so put everything it needs in the task. Agents: ${roster}.`,
    input: z.object({ agent: z.enum(names as [string, ...string[]]), task: z.string().min(1) }),
    ...(options.trusted ? {} : { resultTrust: 'untrusted' as const }),
    execute: async ({ agent, task }, ctx) => {
      const target = options.agents[agent]
      if (!target) throw new Error(`Unknown agent: ${agent}`)
      const result = await target.agent.ask(task, {
        abortSignal: ctx.signal,
        ...(options.maxSteps ? { maxSteps: options.maxSteps } : {}),
      })
      options.onResult?.(agent, result, ctx)
      return { agent, answer: result.text, steps: result.steps }
    },
  })
}
