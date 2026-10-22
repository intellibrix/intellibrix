import { defineTool, type ToolDefinition } from 'intellibrix'
import { z } from 'zod'
import type { Sandbox, SandboxProvider } from './provider.js'

export type SandboxToolOptions = {
  /** Skip the approval prompt. Default `false`: executing code is the highest-blast-radius tool. */
  alwaysApprove?: boolean
  template?: string
  /** Sandbox lifetime requested from the vendor. */
  timeoutMs?: number
  /** Close a run's sandbox after this much idle time. @default 300000 */
  idleTtlMs?: number
}

/** The `run_code` tool plus lifecycle controls for its per-run sandbox cache. */
export type SandboxTool = ToolDefinition & {
  /** Closes the sandbox cached for `runId`, if any. Call when a run finishes. */
  closeRun(runId: string): Promise<void>
  /** Closes every cached sandbox. */
  closeAll(): Promise<void>
}

/**
 * Builds a single `run_code` tool backed by `provider`. One sandbox is created
 * lazily per `runId` and reused for that run's later calls, so state (files,
 * variables) persists across calls within a run. Sandboxes are closed by
 * `closeRun`/`closeAll` or, as a backstop, after `idleTtlMs`.
 */
export function sandboxTool(
  provider: SandboxProvider,
  options: SandboxToolOptions = {},
): SandboxTool {
  const idleTtlMs = options.idleTtlMs ?? 300_000
  const sessions = new Map<string, { sandbox: Promise<Sandbox>; timer?: NodeJS.Timeout }>()

  const closeRun = async (runId: string) => {
    const session = sessions.get(runId)
    if (!session) return
    sessions.delete(runId)
    clearTimeout(session.timer)
    await (await session.sandbox).close()
  }

  const touch = (runId: string) => {
    const session = sessions.get(runId)
    if (!session) return
    clearTimeout(session.timer)
    session.timer = setTimeout(() => void closeRun(runId).catch(() => {}), idleTtlMs)
    session.timer.unref()
  }

  const acquire = (runId: string) => {
    let session = sessions.get(runId)
    if (!session) {
      const sandbox = provider.create({ template: options.template, timeoutMs: options.timeoutMs })
      session = { sandbox }
      sessions.set(runId, session)
      // A failed create must not poison the cache.
      sandbox.catch(() => sessions.delete(runId))
    }
    return session.sandbox
  }

  const tool = defineTool({
    name: 'run_code',
    description: `Execute code in an isolated ${provider.id} sandbox and return stdout, stderr and the exit code. State persists between calls in the same run.`,
    input: z.object({ code: z.string(), language: z.string().optional() }),
    needsApproval: !options.alwaysApprove,
    resultTrust: 'untrusted',
    execute: async ({ code, language }, ctx) => {
      const sandbox = await acquire(ctx.runId)
      try {
        return await sandbox.runCode(code, { language })
      } finally {
        touch(ctx.runId)
      }
    },
  })

  return Object.assign(tool, {
    closeRun,
    closeAll: async () => {
      await Promise.all([...sessions.keys()].map(closeRun))
    },
  })
}
