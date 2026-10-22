import type { Sandbox, SandboxProvider } from '../provider.js'

/**
 * The slice of a [Cloudflare Sandbox](https://developers.cloudflare.com/sandbox/)
 * handle (from `getSandbox(env.Sandbox, id)` inside a Worker) this adapter uses.
 * Cloudflare sandboxes are bound to a Worker's environment, so unlike the other
 * adapters the handle is supplied by the caller rather than imported.
 */
export interface CloudflareSandboxHandle {
  exec(command: string): Promise<{ stdout: string; stderr: string; exitCode: number }>
  writeFile(path: string, contents: string): Promise<unknown>
  destroy?(): Promise<void>
}

const RUNNERS: Record<string, { file: string; command: string }> = {
  python: { file: '/tmp/run.py', command: 'python3 /tmp/run.py' },
  javascript: { file: '/tmp/run.mjs', command: 'node /tmp/run.mjs' },
  bash: { file: '/tmp/run.sh', command: 'bash /tmp/run.sh' },
}

/** Wraps a Cloudflare Sandbox handle. `language` defaults to `python`. */
export function cloudflareProvider(
  getHandle: () => CloudflareSandboxHandle | Promise<CloudflareSandboxHandle>,
): SandboxProvider {
  return {
    id: 'cloudflare',
    async create() {
      const handle = await getHandle()
      const sandbox: Sandbox = {
        async runCode(code, opts) {
          const lang = opts?.language ?? 'python'
          const runner = RUNNERS[lang]
          if (!runner)
            throw new Error(
              `cloudflareProvider supports: ${Object.keys(RUNNERS).join(', ')} (got "${lang}")`,
            )
          await handle.writeFile(runner.file, code)
          return handle.exec(runner.command)
        },
        async close() {
          await handle.destroy?.()
        },
      }
      return sandbox
    },
  }
}
