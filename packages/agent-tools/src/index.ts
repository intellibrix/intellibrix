/**
 * @module AgentTools
 *
 * Patch, verify and planning tools for coding agents: `apply_patch`, `run_checks` and `todo`.
 */
import type { FileTracker } from '@intellibrix/workspace'
import type { ToolDefinition } from 'intellibrix'
import { type AskUserToolOptions, askUserTool } from './ask-user.js'
import { calculatorTool } from './calculator.js'
import { type RunChecksOptions, runChecksTool } from './checks.js'
import { type DatetimeToolOptions, datetimeTool } from './datetime.js'
import { type DelegateToolOptions, delegateTool } from './delegate.js'
import { type FetchUrlToolOptions, fetchUrlTool } from './fetch.js'
import { type ApplyPatchOptions, applyPatchTool } from './patch.js'
import { type SearchProvider, type WebSearchToolOptions, webSearchTool } from './search.js'
import { type TodoToolOptions, todoTool } from './todo.js'

export * from './ask-user.js'
export * from './calculator.js'
export * from './checks.js'
export * from './datetime.js'
export * from './delegate.js'
export * from './fetch.js'
export * from './patch.js'
export * from './search.js'
export * from './todo.js'

export type AgentToolsOptions = {
  root: string
  /** Require approval for `apply_patch`. @default true */
  approveWrites?: boolean
  /** Share the tracker given to `workspaceTools` so `apply_patch` also refuses stale or unread files. */
  tracker?: FileTracker
  /** Configure `run_checks`, or pass `false` to leave it out. Checks are detected from `package.json` by default. */
  checks?: Omit<RunChecksOptions, 'root'> | false
  /** Configure `todo`, or pass `false` to leave it out. */
  todo?: TodoToolOptions | false
  /** Pass `false` to leave out `calculator` (exact arithmetic, no approval needed). */
  calculator?: false
  /** Configure `datetime`, or pass `false` to leave it out. */
  datetime?: DatetimeToolOptions | false
  /** Include `fetch_url`. Omitted by default: pass `true` or options to turn it on. */
  fetch?: FetchUrlToolOptions | true
  /** Include `web_search` over this backend. Omitted unless given. */
  search?: { provider: SearchProvider } & WebSearchToolOptions
  /** Include `ask_user`, answered by `ask`. Omitted unless given. */
  askUser?: AskUserToolOptions
  /** Include `delegate` over these sub-agents. Omitted unless given. */
  delegate?: DelegateToolOptions
}

/**
 * `apply_patch`, `run_checks`, `todo` and `calculator` for a workspace rooted at `root`, plus `fetch_url`,
 * `ask_user` and `delegate` when you configure them.
 */
export function agentTools(options: AgentToolsOptions): ToolDefinition[] {
  const { root } = options
  const patch: ApplyPatchOptions = {
    root,
    approveWrites: options.approveWrites,
    tracker: options.tracker,
  }
  return [
    applyPatchTool(patch),
    ...(options.checks === false ? [] : [runChecksTool({ root, ...options.checks })]),
    ...(options.todo === false ? [] : [todoTool(options.todo)]),
    ...(options.calculator === false ? [] : [calculatorTool()]),
    ...(options.datetime === false ? [] : [datetimeTool(options.datetime)]),
    ...(options.fetch ? [fetchUrlTool(options.fetch === true ? {} : options.fetch)] : []),
    ...(options.search ? [webSearchTool(options.search.provider, options.search)] : []),
    ...(options.askUser ? [askUserTool(options.askUser)] : []),
    ...(options.delegate ? [delegateTool(options.delegate)] : []),
  ]
}
