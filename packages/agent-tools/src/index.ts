/**
 * @module AgentTools
 *
 * Patch, verify and planning tools for coding agents: `apply_patch`, `run_checks` and `todo`.
 */
import type { ToolDefinition } from 'intellibrix'
import { type RunChecksOptions, runChecksTool } from './checks.js'
import { type ApplyPatchOptions, applyPatchTool } from './patch.js'
import { type TodoToolOptions, todoTool } from './todo.js'

export * from './checks.js'
export * from './patch.js'
export * from './todo.js'

export type AgentToolsOptions = {
  root: string
  /** Require approval for `apply_patch`. @default true */
  approveWrites?: boolean
  /** Configure `run_checks`, or pass `false` to leave it out. Checks are detected from `package.json` by default. */
  checks?: Omit<RunChecksOptions, 'root'> | false
  /** Configure `todo`, or pass `false` to leave it out. */
  todo?: TodoToolOptions | false
}

/** `apply_patch`, `run_checks` and `todo` for a workspace rooted at `root`. */
export function agentTools(options: AgentToolsOptions): ToolDefinition[] {
  const { root } = options
  const patch: ApplyPatchOptions = { root, approveWrites: options.approveWrites }
  return [
    applyPatchTool(patch),
    ...(options.checks === false ? [] : [runChecksTool({ root, ...options.checks })]),
    ...(options.todo === false ? [] : [todoTool(options.todo)]),
  ]
}
