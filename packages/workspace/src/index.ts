/**
 * @module Workspace
 *
 * Jailed filesystem, allowlisted shell and git tools for coding agents.
 */
import type { ToolDefinition } from 'intellibrix'
import { type FsToolOptions, fsTools } from './fs-tools.js'
import { gitTools } from './git.js'
import { type ShellToolOptions, shellTool } from './shell.js'

export * from './atomic.js'
export * from './fs-tools.js'
export * from './git.js'
export * from './jail.js'
export * from './read.js'
export * from './shell.js'
export * from './tracker.js'

export type WorkspaceToolsOptions = FsToolOptions & {
  /** Include the `shell` tool with this allowlist. Omit to leave shell out entirely. */
  shell?: Omit<ShellToolOptions, 'root'>
  /** Include git tools. @default true */
  git?: boolean
}

/**
 * The full toolset for a workspace rooted at `root`. Writes, commits and shell
 * all require approval unless explicitly relaxed.
 */
export function workspaceTools(options: WorkspaceToolsOptions): ToolDefinition[] {
  const { root } = options
  return [
    ...fsTools(options),
    ...(options.git === false ? [] : gitTools({ root })),
    ...(options.shell ? [shellTool({ root, ...options.shell })] : []),
  ]
}
