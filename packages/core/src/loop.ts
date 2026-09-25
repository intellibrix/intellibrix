import { randomUUID } from 'node:crypto'

import { type Checkpointer, InMemoryCheckpointer } from './checkpoint.js'
import type { Message, Part, ToolResultPart, Trust } from './messages.js'
import type { FinishReason, GenerateRequest, Provider, StepResult, Usage } from './provider.js'
import {
  type ApprovalDecision,
  resolveNeedsApproval,
  type ToolDefinition,
  validateToolInput,
} from './tool.js'

/**
 * A hook invoked before a gated tool call executes. Return `true`/`false` to
 * approve or deny, or `{ edit }` to approve with substituted input.
 */
export type ApprovalHook = (call: {
  toolName: string
  input: unknown
  runId: string
  trust?: Trust
}) => ApprovalDecision | Promise<ApprovalDecision>

/**
 * Typed events emitted at every stage of {@link runAgentLoop}.
 */
export type LoopEvent =
  | { type: 'step-start'; stepIndex: number }
  | { type: 'step-finish'; stepIndex: number; result: StepResult }
  | { type: 'tool-call-start'; toolCallId: string; toolName: string; input: unknown }
  | { type: 'tool-call-approval-required'; toolCallId: string; toolName: string; input: unknown }
  | { type: 'tool-call-denied'; toolCallId: string; toolName: string }
  | {
      type: 'tool-call-finish'
      toolCallId: string
      toolName: string
      output: unknown
      isError?: boolean
    }
  | { type: 'loop-finish'; messages: Message[]; steps: number }
  | { type: 'error'; error: unknown }

export type LoopOptions = {
  provider: Provider
  model: string
  system?: string
  messages: Message[]
  tools?: ToolDefinition[]
  maxSteps?: number
  /** Called once per step; return `true` to stop the loop after this step. */
  stopWhen?: (result: StepResult) => boolean | Promise<boolean>
  onToolApproval?: ApprovalHook
  onEvent?: (event: LoopEvent) => void
  abortSignal?: AbortSignal
  runId?: string
  brick?: unknown
  checkpointer?: Checkpointer
  /** When true, resumes from the checkpointer's saved state for `runId` instead of starting fresh. */
  resume?: boolean
}

export type LoopResult = {
  messages: Message[]
  steps: number
  usage: Usage
  finishReason: FinishReason
}

function addUsage(total: Usage, add?: Usage): Usage {
  return {
    inputTokens: (total.inputTokens ?? 0) + (add?.inputTokens ?? 0),
    outputTokens: (total.outputTokens ?? 0) + (add?.outputTokens ?? 0),
    totalTokens: (total.totalTokens ?? 0) + (add?.totalTokens ?? 0),
  }
}

function inputTrust(input: unknown): Trust | undefined {
  if (input && typeof input === 'object' && 'trust' in input) {
    const trust = (input as { trust?: unknown }).trust
    if (trust === 'trusted' || trust === 'untrusted') return trust
  }

  return undefined
}

/**
 * Runs a single agent loop: generate -> append -> (if tool calls) execute in
 * parallel, gated by approval -> append results -> repeat, until the model
 * stops calling tools, `stopWhen` returns true, `maxSteps` is reached, or the
 * loop is aborted.
 */
export async function runAgentLoop(opts: LoopOptions): Promise<LoopResult> {
  const runId = opts.runId ?? randomUUID()
  const maxSteps = opts.maxSteps ?? 10
  const checkpointer = opts.checkpointer ?? new InMemoryCheckpointer()
  const emit = (event: LoopEvent) => opts.onEvent?.(event)

  let messages = [...opts.messages]
  let stepIndex = 0
  let usage: Usage = {}
  let finishReason: FinishReason = 'stop'

  if (opts.resume) {
    const saved = await checkpointer.load(runId)
    if (saved) {
      messages = saved.messages
      stepIndex = saved.stepIndex
    }
  }

  const toolsByName = new Map((opts.tools ?? []).map((tool) => [tool.name, tool]))

  while (stepIndex < maxSteps) {
    if (opts.abortSignal?.aborted) break

    await checkpointer.save(runId, { messages, stepIndex })
    emit({ type: 'step-start', stepIndex })

    const request: GenerateRequest = {
      model: opts.model,
      system: opts.system,
      messages,
      tools: opts.tools,
      abortSignal: opts.abortSignal,
    }

    let result: StepResult
    try {
      result = await opts.provider.generate(request)
    } catch (error) {
      emit({ type: 'error', error })
      throw error
    }

    usage = addUsage(usage, result.usage)
    finishReason = result.finishReason
    messages = [...messages, result.message]
    stepIndex += 1
    emit({ type: 'step-finish', stepIndex, result })

    const toolCalls = result.message.content.filter(
      (part): part is Extract<Part, { type: 'tool-call' }> => part.type === 'tool-call',
    )

    const shouldStop = opts.stopWhen ? await opts.stopWhen(result) : false
    if (toolCalls.length === 0 || shouldStop) {
      await checkpointer.save(runId, { messages, stepIndex })
      break
    }
    if (opts.abortSignal?.aborted) break

    const resultParts: ToolResultPart[] = await Promise.all(
      toolCalls.map(async (call): Promise<ToolResultPart> => {
        emit({
          type: 'tool-call-start',
          toolCallId: call.toolCallId,
          toolName: call.toolName,
          input: call.input,
        })

        const tool = toolsByName.get(call.toolName)
        if (!tool) {
          const output = { error: `Unknown tool: ${call.toolName}` }
          emit({
            type: 'tool-call-finish',
            toolCallId: call.toolCallId,
            toolName: call.toolName,
            output,
            isError: true,
          })
          return {
            type: 'tool-result',
            toolCallId: call.toolCallId,
            toolName: call.toolName,
            output,
            isError: true,
          }
        }

        try {
          let input = await validateToolInput(tool, call.input)
          const trust = call.trust ?? inputTrust(call.input)
          const ctx = { brick: opts.brick, signal: opts.abortSignal, runId, trust }

          const needsApproval = await resolveNeedsApproval(tool, input, ctx)
          if (needsApproval) {
            emit({
              type: 'tool-call-approval-required',
              toolCallId: call.toolCallId,
              toolName: call.toolName,
              input,
            })

            const decision = opts.onToolApproval
              ? await opts.onToolApproval({ toolName: call.toolName, input, runId, trust })
              : false

            if (decision === false) {
              emit({
                type: 'tool-call-denied',
                toolCallId: call.toolCallId,
                toolName: call.toolName,
              })
              const output = { error: 'Tool call denied by approval policy' }
              return {
                type: 'tool-result',
                toolCallId: call.toolCallId,
                toolName: call.toolName,
                output,
                isError: true,
              }
            }

            if (typeof decision === 'object' && 'edit' in decision)
              input = decision.edit as typeof input
          }

          if (opts.abortSignal?.aborted) {
            const output = { error: 'Aborted' }
            return {
              type: 'tool-result',
              toolCallId: call.toolCallId,
              toolName: call.toolName,
              output,
              isError: true,
            }
          }

          const output = await tool.execute(input, ctx)
          emit({
            type: 'tool-call-finish',
            toolCallId: call.toolCallId,
            toolName: call.toolName,
            output,
          })
          return {
            type: 'tool-result',
            toolCallId: call.toolCallId,
            toolName: call.toolName,
            output,
          }
        } catch (error) {
          const output = { error: error instanceof Error ? error.message : String(error) }
          emit({
            type: 'tool-call-finish',
            toolCallId: call.toolCallId,
            toolName: call.toolName,
            output,
            isError: true,
          })
          return {
            type: 'tool-result',
            toolCallId: call.toolCallId,
            toolName: call.toolName,
            output,
            isError: true,
          }
        }
      }),
    )

    messages = [...messages, { role: 'tool', content: resultParts }]
    await checkpointer.save(runId, { messages, stepIndex })

    const shouldStopAfterTools = opts.stopWhen ? await opts.stopWhen(result) : false
    if (shouldStopAfterTools) break
  }

  emit({ type: 'loop-finish', messages, steps: stepIndex })
  return { messages, steps: stepIndex, usage, finishReason }
}
