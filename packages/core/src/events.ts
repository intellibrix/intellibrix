import type { Trust } from './messages.js'
import type { ApprovalDecision } from './tool.js'

/**
 * Structural observability events, layered onto {@link LoopEvent} (additive,
 * not a replacement — nothing already consuming `LoopEvent`s breaks). Emitted
 * at the same call sites `loop.ts` already defines: around each
 * `Provider.generate`/`stream` call, around the existing parallel tool
 * dispatch, around the existing `onToolApproval` hook, and once per
 * `runAgentLoop()` call (and again around `brick.ask()`'s own invocation of
 * it, annotated with a `brickName`).
 */
export type RunEvent =
  | { type: 'run:start'; runId: string; brickName?: string }
  | { type: 'run:finish'; runId: string; brickName?: string; steps: number }
  | { type: 'model:start'; runId: string; stepIndex: number; model: string }
  | { type: 'model:finish'; runId: string; stepIndex: number; model: string; durationMs: number }
  | { type: 'tool:call'; runId: string; toolCallId: string; toolName: string; input: unknown }
  | {
      type: 'tool:result'
      runId: string
      toolCallId: string
      toolName: string
      output: unknown
      durationMs: number
    }
  | { type: 'tool:error'; runId: string; toolCallId: string; toolName: string; error: unknown }
  | {
      type: 'approval:requested'
      runId: string
      toolCallId: string
      toolName: string
      input: unknown
      trust?: Trust
    }
  | {
      type: 'approval:resolved'
      runId: string
      toolCallId: string
      toolName: string
      decision: ApprovalDecision
    }

/**
 * A callback invoked with each {@link RunEvent}, wired via `LoopOptions.onRunEvent`.
 */
export type RunEventHandler = (event: RunEvent) => void
