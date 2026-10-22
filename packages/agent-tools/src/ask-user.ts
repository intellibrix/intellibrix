import { defineTool, type ToolContext, type ToolDefinition } from 'intellibrix'
import { z } from 'zod'

/** A question the model wants a human to answer. */
export type UserQuestion = {
  question: string
  /** Suggested answers; the human may still answer freely. */
  choices?: string[]
}

export type AskUserToolOptions = {
  /**
   * Puts the question to a human and resolves with their answer, e.g. with
   * `brick.print` and `brick.input` in a terminal, or a prompt in your UI.
   */
  ask: (question: UserQuestion, ctx: ToolContext) => Promise<string>
}

/**
 * An `ask_user` tool: the model pauses to ask the human a clarifying question instead of guessing.
 * The host decides how the question is shown and answered. The answer is the human's own words, so
 * it is trusted.
 */
export function askUserTool({ ask }: AskUserToolOptions): ToolDefinition {
  return defineTool({
    name: 'ask_user',
    description:
      'Ask the human a question when the request is ambiguous or you need a decision only they can make. Prefer this to guessing. Optionally offer choices.',
    input: z.object({
      question: z.string().min(1),
      choices: z.array(z.string().min(1)).max(10).optional(),
    }),
    execute: async ({ question, choices }, ctx) => ({
      answer: await ask({ question, ...(choices ? { choices } : {}) }, ctx),
    }),
  })
}
