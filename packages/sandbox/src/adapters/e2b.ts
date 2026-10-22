import { importVendor, type Sandbox, type SandboxProvider } from '../provider.js'

type E2BExecution = {
  logs: { stdout: string[]; stderr: string[] }
  error?: { name: string; value: string; traceback: string }
}
type E2BSandbox = {
  runCode(code: string, opts?: { language?: string }): Promise<E2BExecution>
  kill(): Promise<unknown>
}
type E2BModule = {
  Sandbox: {
    create(opts?: Record<string, unknown>): Promise<E2BSandbox>
    create(template: string, opts?: Record<string, unknown>): Promise<E2BSandbox>
  }
}

export type E2BProviderOptions = { apiKey?: string }

/** [E2B](https://e2b.dev) code-interpreter sandboxes. Requires `@e2b/code-interpreter`. */
export function e2bProvider(options: E2BProviderOptions = {}): SandboxProvider {
  return {
    id: 'e2b',
    async create(opts) {
      const mod = await importVendor<E2BModule>('@e2b/code-interpreter', 'e2bProvider')
      const sdkOpts = { apiKey: options.apiKey, timeoutMs: opts?.timeoutMs }
      const sbx = opts?.template
        ? await mod.Sandbox.create(opts.template, sdkOpts)
        : await mod.Sandbox.create(sdkOpts)
      const sandbox: Sandbox = {
        async runCode(code, runOpts) {
          const exec = await sbx.runCode(
            code,
            runOpts?.language ? { language: runOpts.language } : undefined,
          )
          const stderr = [
            ...exec.logs.stderr,
            ...(exec.error ? [exec.error.traceback || exec.error.value] : []),
          ]
          return {
            stdout: exec.logs.stdout.join(''),
            stderr: stderr.join(''),
            exitCode: exec.error ? 1 : 0,
          }
        },
        async close() {
          await sbx.kill()
        },
      }
      return sandbox
    },
  }
}
