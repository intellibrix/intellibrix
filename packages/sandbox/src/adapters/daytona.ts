import { importVendor, type Sandbox, type SandboxProvider } from '../provider.js'

type DaytonaSandbox = {
  process: { codeRun(code: string): Promise<{ exitCode: number; result: string }> }
  delete(): Promise<unknown>
}
type DaytonaModule = {
  Daytona: new (
    config?: Record<string, unknown>,
  ) => {
    create(params?: Record<string, unknown>): Promise<DaytonaSandbox>
  }
}

export type DaytonaProviderOptions = { apiKey?: string; apiUrl?: string; language?: string }

/** [Daytona](https://daytona.io) sandboxes. Requires `@daytonaio/sdk`. */
export function daytonaProvider(options: DaytonaProviderOptions = {}): SandboxProvider {
  return {
    id: 'daytona',
    async create() {
      const mod = await importVendor<DaytonaModule>('@daytonaio/sdk', 'daytonaProvider')
      const client = new mod.Daytona({ apiKey: options.apiKey, apiUrl: options.apiUrl })
      const sbx = await client.create(options.language ? { language: options.language } : undefined)
      const sandbox: Sandbox = {
        async runCode(code) {
          // Daytona merges the streams into `result`.
          const r = await sbx.process.codeRun(code)
          return {
            stdout: r.exitCode === 0 ? r.result : '',
            stderr: r.exitCode === 0 ? '' : r.result,
            exitCode: r.exitCode,
          }
        },
        async close() {
          await sbx.delete()
        },
      }
      return sandbox
    },
  }
}
