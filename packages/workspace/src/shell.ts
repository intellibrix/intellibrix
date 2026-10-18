import { execFile } from 'node:child_process'
import { defineTool, type ToolDefinition } from 'intellibrix'
import { z } from 'zod'
import { resolveJailed } from './jail.js'

const MAX_OUTPUT = 64 * 1024

export type ShellToolOptions = {
  root: string
  /** Bare command names the model may run, e.g. `['node', 'pnpm', 'git']`. Resolved through `PATH`. */
  allow: string[]
  /** Skip the approval prompt (CI / non-interactive use). @default false */
  alwaysApprove?: boolean
  /** Default timeout in ms. @default 30000 */
  timeoutMs?: number
}

/**
 * A `shell` tool that runs allowlisted binaries via `execFile` — never through
 * a shell, so there is no metacharacter interpolation. `command` must be a
 * bare name that is on the allowlist; anything containing a path separator is
 * rejected, so an allowlisted name cannot be satisfied by an arbitrary binary
 * at some path (e.g. `/tmp/x/git`).
 */
export function shellTool(options: ShellToolOptions): ToolDefinition {
  const allow = new Set(options.allow)
  return defineTool({
    name: 'shell',
    description: `Run an allowlisted command (${[...allow].join(', ') || 'none'}) without a shell. Pass arguments in args.`,
    input: z.object({
      command: z.string(),
      args: z.array(z.string()).default([]),
      cwd: z.string().optional(),
      timeoutMs: z.number().int().positive().optional(),
    }),
    needsApproval: !options.alwaysApprove,
    resultTrust: 'untrusted',
    execute: async ({ command, args, cwd, timeoutMs }, ctx) => {
      if (!allow.has(command) || /[\\/]/.test(command)) {
        throw new Error(`Command not allowed: ${command}`)
      }
      const workdir = await resolveJailed(options.root, cwd ?? '.')
      return new Promise<{ stdout: string; stderr: string; exitCode: number; timedOut: boolean }>(
        (resolve) => {
          execFile(
            command,
            args,
            {
              cwd: workdir,
              timeout: timeoutMs ?? options.timeoutMs ?? 30_000,
              signal: ctx.signal,
              maxBuffer: MAX_OUTPUT * 4,
            },
            (error, stdout, stderr) => {
              const e = error as
                | (NodeJS.ErrnoException & { killed?: boolean; code?: number | string })
                | null
              if (
                e &&
                typeof e.code === 'string' &&
                e.code !== 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'
              ) {
                // spawn failure (ENOENT etc.) or abort
                resolve({ stdout: '', stderr: e.message, exitCode: -1, timedOut: false })
                return
              }
              resolve({
                stdout: stdout.slice(0, MAX_OUTPUT),
                stderr: stderr.slice(0, MAX_OUTPUT),
                exitCode: e ? (typeof e.code === 'number' ? e.code : 1) : 0,
                timedOut: Boolean(e?.killed),
              })
            },
          )
        },
      )
    },
  })
}
